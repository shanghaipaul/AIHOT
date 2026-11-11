// 字幕精华提炼：把整段字幕交给模型，换成一份格式化的中文提炼。
// 产出结构：结论一句话 + 摘要 + 要点 + 关键数据 + 名词表 + 适合谁 + 注意事项。
// 模型只在后台任务或手动触发时调用，读者打开页面不会走到这里。
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { chatJson } from "@aihot/backend/providers/llm";
import { modelFor } from "@aihot/backend/editorial/models";

/** 提示词的版本：改了就换版本号，旧答案不会被当成这次的答案。 */
export const DIGEST_PROMPT_VERSION = "youtube-digest-zh@v1";

/** 一次喂给模型的字幕上限：超过就分段读，再合并。 */
const MAX_TRANSCRIPT = 20_000;

/** 长字幕的分段大小。 */
const CHUNK_SIZE = 14_000;

const MAX_POINTS = 8;
const MAX_DATA = 8;
const MAX_ENTITIES = 10;
const MAX_CAVEATS = 5;
const MAX_SUMMARY = 1200;
const MAX_ONELINER = 160;

const DataPoint = z.object({
  label: z.string().catch(""),
  value: z.string().catch(""),
  note: z.string().catch("").optional(),
});

const Entity = z.object({
  name: z.string().catch(""),
  note: z.string().catch("").optional(),
});

/** 模型回答的形状：字段都可缺省，模型少给或给错类型都不至于整条作废。 */
export const Digest = z.object({
  one_liner: z.string().catch(""),
  summary: z.string().catch(""),
  key_points: z.array(z.string()).catch([]),
  data_points: z.array(DataPoint).catch([]),
  entities: z.array(Entity).catch([]),
  audience: z.string().catch(""),
  caveats: z.array(z.string()).catch([]),
});

/** 分段阅读时每段只摘要点。 */
const Chunk = z.object({
  points: z.array(z.string()).catch([]),
});

const SYSTEM = [
  "你把一个 YouTube 视频的字幕提炼成结构化的中文笔记，让没看视频的人一眼看懂这期讲了什么。",
  "规则：",
  "1. 只输出 JSON，字段：one_liner、summary、key_points、data_points、entities、audience、caveats。",
  "2. one_liner：一句话结论，40 字以内。",
  "3. summary：150 到 250 字中文摘要，按「这期讲了什么 → 关键结论 → 对谁有用」写，不要 Markdown。",
  "4. key_points：4 到 6 条要点，每条 20 到 40 字，尽量带具体数字、版本号、名字，不要跟摘要重复。",
  "5. data_points：0 到 6 条关键数据，每条 {label, value, note}；label 写指标名，value 写数值，note 一句话说明。价格、跑分、参数量、时间点这类才写。",
  "6. entities：0 到 8 条提到的产品、模型、公司、工具，每条 {name, note}；name 保留原文名不要翻译。",
  "7. audience：一句话说明适合谁看、对哪类任务有用。",
  "8. caveats：0 到 3 条注意事项、坑、争议或适用边界；没有就空数组。",
  "9. 只写字幕里出现过的内容，数字要准确，不要编；不确定的就不写。",
].join("\n");

const CHUNK_SYSTEM = [
  "你在分段阅读一个视频的字幕，把这一段里值得记住的事实摘出来。",
  "只输出 JSON：{\"points\":[\"...\"]}",
  "points：3 到 6 条，每条 20 到 40 字，具体（带数字或名字），保留原文名字。",
  "只写这一段里出现的内容，不要编。",
].join("\n");

interface VideoRow {
  video_id: string;
  channel_id: string;
  channel_title: string | null;
  title: string;
  duration_seconds: number | null;
  published_at: Date | null;
  transcript: string;
}

/** 字幕变了就该重写一次提炼。 */
export function digestHash(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

/** 写进库之前统一收一下长度。 */
export function clampDigest(data: z.infer<typeof Digest>): z.infer<typeof Digest> {
  const list = (items: string[], max: number): string[] =>
    items.map((item) => String(item).trim()).filter((item) => item !== "").slice(0, max);
  return {
    one_liner: data.one_liner.trim().slice(0, MAX_ONELINER),
    summary: data.summary.trim().slice(0, MAX_SUMMARY),
    key_points: list(data.key_points, MAX_POINTS),
    data_points: data.data_points
      .map((item) => ({ label: item.label.trim(), value: item.value.trim(), note: (item.note ?? "").trim() }))
      .filter((item) => item.label !== "" || item.value !== "")
      .slice(0, MAX_DATA),
    entities: data.entities
      .map((item) => ({ name: item.name.trim(), note: (item.note ?? "").trim() }))
      .filter((item) => item.name !== "")
      .slice(0, MAX_ENTITIES),
    audience: data.audience.trim(),
    caveats: list(data.caveats, MAX_CAVEATS),
  };
}

/** 长字幕按固定长度切开（尽量在句读处切）。 */
export function chunkTranscript(text: string, size = CHUNK_SIZE): string[] {
  const clean = text.trim();
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let rest = clean;
  while (rest.length > size) {
    let cut = rest.slice(0, size);
    const mark = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("，"), cut.lastIndexOf(" "));
    if (mark > size * 0.6) cut = cut.slice(0, mark + 1);
    chunks.push(cut);
    rest = rest.slice(cut.length);
  }
  if (rest.trim() !== "") chunks.push(rest);
  return chunks;
}

/** 给模型看的材料。分段模式下给的是各段要点。 */
function buildUser(video: VideoRow, body: string, chunked: boolean): string {
  const lines = [
    "标题：" + video.title,
    "频道：" + (video.channel_title ?? ""),
    "时长（秒）：" + String(video.duration_seconds ?? 0),
  ];
  if (chunked) {
    lines.push("下面是把整段字幕分段读完后摘出的要点（已覆盖全片）：");
    lines.push(body);
  } else {
    lines.push("字幕全文：");
    lines.push(body);
  }
  return lines.join("\n");
}

/** 错误归类：422 是内容侧拒收（换一次输入它也不收），其它都能重试。 */
export function digestStatusForError(error: unknown): "blocked" | "failed" {
  const status = (error as { status?: number | null } | null)?.status;
  return status === 422 ? "blocked" : "failed";
}

export function digestErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 300);
}

async function recordFailure(videoId: string, error: unknown, video?: { channel_id: string; title: string }): Promise<void> {
  const status = digestStatusForError(error);
  const message = digestErrorSummary(error);
  await sql`
    INSERT INTO youtube_digests (video_id, channel_id, title, one_liner, summary_zh, key_points, data_points, entities, audience, caveats, transcript_hash, model, prompt_version, status, last_error, updated_at)
    VALUES (${videoId}, ${video?.channel_id ?? null}, ${video?.title ?? null}, '', '', ${sql.json([] as never)}::jsonb, ${sql.json([] as never)}::jsonb, ${sql.json([] as never)}::jsonb, '', ${sql.json([] as never)}::jsonb, null, null, ${DIGEST_PROMPT_VERSION}, ${status}, ${message}, now())
    ON CONFLICT (video_id) DO UPDATE SET
      status = EXCLUDED.status,
      last_error = EXCLUDED.last_error,
      updated_at = now()
    WHERE youtube_digests.status IS DISTINCT FROM 'done'`;
}

/** 提炼一个视频并写进 youtube_digests。字幕没变、已有提炼时不动它，返回 false。 */
export async function digestVideo(videoId: string, options?: { force?: boolean }): Promise<boolean> {
  const rows = await sql<VideoRow[]>`
    SELECT v.video_id, v.channel_id, v.title, v.duration_seconds, v.published_at, s.content_text AS transcript, c.title AS channel_title
    FROM youtube_videos v
    JOIN youtube_channels c ON c.channel_id = v.channel_id
    JOIN youtube_subtitles s ON s.video_id = v.video_id
    WHERE v.video_id = ${videoId} AND s.content_text IS NOT NULL AND s.content_text <> ''`;
  const video = rows[0];
  if (!video) return false;

  const hash = digestHash(video.transcript);
  const existing = await sql<({ transcript_hash: string | null; status: string | null })[]>`
    SELECT transcript_hash, status FROM youtube_digests WHERE video_id = ${videoId}`;
  if (existing[0]?.status === "blocked") return false;
  if (!options?.force && existing[0]?.transcript_hash === hash) return false;

  const model = await modelFor("youtubeAnalyze");
  const chunks = chunkTranscript(video.transcript);
  const chunked = chunks.length > 1;
  let body: string;
  if (chunked) {
    const points: string[] = [];
    for (const chunk of chunks) {
      const result = await chatJson({
        model,
        purpose: "youtube_digest",
        subject: "youtube:" + videoId,
        promptVersion: DIGEST_PROMPT_VERSION + ":chunk",
        system: CHUNK_SYSTEM,
        user: "这一段字幕：\n" + chunk,
        schema: Chunk,
        temperature: 0.2,
        maxTokens: 1200,
        timeoutMs: 150_000,
      });
      points.push(...result.data.points.map((item) => String(item).trim()).filter((item) => item !== ""));
    }
    body = points.map((item, index) => (index + 1) + ". " + item).join("\n");
  } else {
    body = video.transcript.slice(0, MAX_TRANSCRIPT);
  }

  const result = await chatJson({
    model,
    purpose: "youtube_digest",
    subject: "youtube:" + videoId,
    promptVersion: DIGEST_PROMPT_VERSION,
    system: SYSTEM,
    user: buildUser(video, body, chunked),
    schema: Digest,
    temperature: 0.2,
    maxTokens: 3000,
    timeoutMs: 240_000,
  }).catch(async (error: unknown) => {
    await recordFailure(videoId, error, { channel_id: video.channel_id, title: video.title });
    throw error;
  });

  const data = clampDigest(result.data);
  await sql`
    INSERT INTO youtube_digests (video_id, channel_id, title, one_liner, summary_zh, key_points, data_points, entities, audience, caveats, transcript_hash, model, prompt_version, status, last_error, updated_at)
    VALUES (${videoId}, ${video.channel_id}, ${video.title}, ${data.one_liner}, ${data.summary}, ${sql.json(data.key_points as never)}::jsonb, ${sql.json(data.data_points as never)}::jsonb, ${sql.json(data.entities as never)}::jsonb, ${data.audience}, ${sql.json(data.caveats as never)}::jsonb, ${hash}, ${result.model ?? model}, ${DIGEST_PROMPT_VERSION}, 'done', null, now())
    ON CONFLICT (video_id) DO UPDATE SET
      one_liner = EXCLUDED.one_liner,
      summary_zh = EXCLUDED.summary_zh,
      key_points = EXCLUDED.key_points,
      data_points = EXCLUDED.data_points,
      entities = EXCLUDED.entities,
      audience = EXCLUDED.audience,
      caveats = EXCLUDED.caveats,
      transcript_hash = EXCLUDED.transcript_hash,
      model = EXCLUDED.model,
      prompt_version = EXCLUDED.prompt_version,
      status = 'done',
      last_error = NULL,
      updated_at = now()`;
  return true;
}

/** 提炼还没提炼过、或字幕变了的视频。返回 {built, skipped, failed}。 */
export async function buildDigests(options?: { limit?: number; force?: boolean }): Promise<{ built: number; skipped: number; failed: number }> {
  const limit = options?.limit ?? 50;
  const rows = await sql<(VideoRow & { stored_hash: string | null; status: string | null })[]>`
    SELECT v.video_id, v.channel_id, v.title, v.duration_seconds, v.published_at,
      s.content_text AS transcript, c.title AS channel_title, d.transcript_hash AS stored_hash, d.status
    FROM youtube_videos v
    JOIN youtube_channels c ON c.channel_id = v.channel_id
    JOIN youtube_subtitles s ON s.video_id = v.video_id
    LEFT JOIN youtube_digests d ON d.video_id = v.video_id
    WHERE s.content_text IS NOT NULL AND s.content_text <> '' AND d.status IS DISTINCT FROM 'blocked'
    ORDER BY (d.video_id IS NULL) DESC, v.published_at DESC NULLS LAST
    LIMIT ${limit * 3}`;
  const pending = rows
    .filter((row) => options?.force || row.stored_hash !== digestHash(row.transcript))
    .slice(0, limit);
  let built = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      const done = await digestVideo(row.video_id, { force: options?.force });
      if (done) built += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.error("youtube: 提炼 " + row.video_id + " 失败", error);
    }
  }
  return { built, skipped, failed };
}

export interface DigestRow {
  video_id: string;
  channel_id: string | null;
  channel_title: string | null;
  title: string | null;
  duration_seconds: number | null;
  published_at: Date | null;
  one_liner: string | null;
  summary_zh: string | null;
  key_points: unknown;
  data_points: unknown;
  entities: unknown;
  audience: string | null;
  caveats: unknown;
  model: string | null;
  prompt_version: string | null;
  status: string | null;
  last_error: string | null;
  updated_at: Date | null;
}

/** 读所有提炼好的条目（按发布时间从新到旧）。 */
export async function loadDigests(): Promise<DigestRow[]> {
  return sql<DigestRow[]>`
    SELECT d.video_id, d.channel_id, c.title AS channel_title, d.title,
      v.duration_seconds, v.published_at, d.one_liner, d.summary_zh, d.key_points, d.data_points,
      d.entities, d.audience, d.caveats, d.model, d.prompt_version, d.status, d.last_error, d.updated_at
    FROM youtube_digests d
    JOIN youtube_videos v ON v.video_id = d.video_id
    LEFT JOIN youtube_channels c ON c.channel_id = d.channel_id
    WHERE d.status = 'done'
    ORDER BY v.published_at DESC NULLS LAST`;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

interface DataPointOut { label: string; value: string; note: string }
interface EntityOut { name: string; note: string }

function asDataPoints(value: unknown): DataPointOut[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return { label: String(row.label ?? ""), value: String(row.value ?? ""), note: String(row.note ?? "") };
  });
}

function asEntities(value: unknown): EntityOut[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return { name: String(row.name ?? ""), note: String(row.note ?? "") };
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m + ":" + String(s).padStart(2, "0");
}

function formatDate(value: Date | null): string {
  if (!value) return "";
  const d = new Date(value);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return d.getUTCFullYear() + "-" + month + "-" + day;
}

/** 把提炼渲染成一份可直接阅读的 Markdown。 */
export function renderDigestsMarkdown(rows: DigestRow[], options?: { date?: string }): string {
  const date = options?.date ?? formatDate(new Date());
  const out: string[] = [];
  out.push("# YouTube 字幕精华提炼 · " + date);
  out.push("");
  out.push("共 " + rows.length + " 篇，每篇由字幕自动提炼：结论、摘要、要点、关键数据、名词表、适合谁、注意事项。字幕是机器识别的，可能有错字；数据以视频原声为准。");
  out.push("");
  out.push("## 目录");
  out.push("");
  rows.forEach((row, index) => {
    const title = (row.title ?? row.video_id).trim();
    out.push((index + 1) + ". [" + title + "](#" + (index + 1) + "-" + title.replace(/[^\u4e00-\u9fa5\w]+/g, "-").replace(/-+/g, "-").toLowerCase() + ") — " + (row.channel_title ?? "") + " · " + formatDuration(row.duration_seconds) + " · " + formatDate(row.published_at));
  });
  out.push("");
  out.push("---");
  rows.forEach((row, index) => {
    const title = (row.title ?? row.video_id).trim();
    out.push("");
    out.push("## " + (index + 1) + ". " + title);
    out.push("");
    const meta = [
      "【频道】" + (row.channel_title ?? ""),
      "【时长】" + formatDuration(row.duration_seconds),
      "【发布时间】" + formatDate(row.published_at),
      "【原视频】https://www.youtube.com/watch?v=" + row.video_id,
    ];
    out.push(meta.join(" "));
    out.push("");
    if ((row.one_liner ?? "").trim() !== "") {
      out.push("**一句话结论**：" + (row.one_liner ?? "").trim());
      out.push("");
    }
    if ((row.summary_zh ?? "").trim() !== "") {
      out.push("**摘要**");
      out.push("");
      out.push((row.summary_zh ?? "").trim());
      out.push("");
    }
    const points = asStrings(row.key_points);
    if (points.length) {
      out.push("**关键要点**");
      out.push("");
      points.forEach((item) => out.push("- " + item));
      out.push("");
    }
    const dataPoints = asDataPoints(row.data_points);
    if (dataPoints.length) {
      out.push("**关键数据**");
      out.push("");
      out.push("| 项 | 数值 | 说明 |");
      out.push("| --- | --- | --- |");
      dataPoints.forEach((item) => out.push("| " + item.label + " | " + item.value + " | " + item.note + " |"));
      out.push("");
    }
    const entities = asEntities(row.entities);
    if (entities.length) {
      out.push("**提到的产品与模型**");
      out.push("");
      entities.forEach((item) => out.push("- " + item.name + (item.note ? "：" + item.note : "")));
      out.push("");
    }
    if ((row.audience ?? "").trim() !== "") {
      out.push("**适合谁**：" + (row.audience ?? "").trim());
      out.push("");
    }
    const caveats = asStrings(row.caveats);
    if (caveats.length) {
      out.push("**注意事项**");
      out.push("");
      caveats.forEach((item) => out.push("- " + item));
      out.push("");
    }
  });
  out.push("");
  return out.join("\n");
}
