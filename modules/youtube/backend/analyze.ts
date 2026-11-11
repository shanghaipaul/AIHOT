// 视频分析：把字幕交给模型，换成中文摘要、要点和标签。
// 模型只在 worker 的定时任务里被调用，读者打开页面不会走到这里。
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { chatJson } from "@aihot/backend/providers/llm";
import { modelFor } from "@aihot/backend/editorial/models";
import { limitFromEnv } from "./fetch.ts";

/**
 * 模型回答的形状：中文摘要、若干条要点、若干个标签。
 * 这里不写死条数上限：模型偶尔会多给几条，写进库之前统一截断（见 clampLists），
 * 总比整条分析作废强。
 */
const Output = z.object({
  summary_zh: z.string().min(40),
  key_points: z.array(z.string()).min(3),
  topics: z.array(z.string()).min(2),
});

/** 提示词的版本：改了就换版本号，旧答案就不会被当成这次的答案。 */
const PROMPT_VERSION = "youtube-zh@v1";

/** 字幕太长就截断，模型一次读不完一整期的字幕。 */
const MAX_TRANSCRIPT = 12_000;

/** 要点和标签最多留几条。 */
const MAX_LIST = 5;

/** 摘要最多留多少字。 */
const MAX_SUMMARY = 600;

const SYSTEM = [
  "你把一个 YouTube 视频的内容整理成中文，让没看视频的人也知道这期讲了什么。",
  "规则：",
  "1. 只输出 JSON：{\"summary_zh\":\"...\",\"key_points\":[\"...\"],\"topics\":[\"...\"]}。",
  "2. summary_zh 是 100 到 200 字的中文摘要，说清这期视频讲了什么、对哪类读者有用；不加 Markdown，不加引号。",
  "3. key_points 是 3 到 5 条要点，每条 15 到 30 个字，一条一个观点，不要跟摘要重复。",
  "4. topics 是 2 到 5 个中文标签，每个 2 到 8 个字。",
  "5. 公司名、产品名、模型名保留原文，不要翻译成别的名字。",
  "6. 字幕里没有说的内容不要编，摘要只写字幕里有的东西。",
].join("\n");

/** 视频的行：分析要用的东西都在这里。 */
interface VideoRow {
  video_id: string;
  title: string;
  description: string | null;
  transcript: string | null;
}

/**
 * 内容的指纹：字幕变了（重新出了字幕、字幕被改了）就该重写一次分析。
 * 没有字幕时用标题和简介算，指纹一样就说明内容没变。
 */
function contentHash(video: VideoRow): string {
  const source = (video.transcript ?? "").trim() !== ""
    ? video.transcript ?? ""
    : (video.title ?? "") + "\n" + (video.description ?? "");
  return createHash("sha256").update(source).digest("hex");
}

/**
 * 写进库之前统一收一下长度：模型偶尔会多给几条要点或标签，
 * 截断比整条分析作废强；摘要也顺手裁一下。
 */
export function clampLists(data: { summary_zh: string; key_points: string[]; topics: string[] }): {
  summary_zh: string;
  key_points: string[];
  topics: string[];
} {
  const clean = (items: string[]): string[] =>
    items.slice(0, MAX_LIST).map((item) => item.trim()).filter((item) => item !== "");
  return {
    summary_zh: data.summary_zh.trim().slice(0, MAX_SUMMARY),
    key_points: clean(data.key_points),
    topics: clean(data.topics),
  };
}

/**
 * 失败归类：422 是模型内容侧拒收（这段输入它不收，重试多少次都一样），
 * 其它都是临时故障（网络、超时），下一轮可以再试。
 */
export function statusForError(error: unknown): "blocked" | "failed" {
  const status = (error as { status?: number | null } | null)?.status;
  return status === 422 ? "blocked" : "failed";
}

/** 错误摘要：写进 last_error，人看一眼就知道卡在哪。 */
export function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 300);
}

/** 给模型看的内容：标题、频道、简介和字幕。没有字幕时就说清楚没有。 */
function buildUser(video: VideoRow & { channel_title: string | null }, options?: { withoutTranscript?: boolean }): string {
  const full = (video.transcript ?? "").trim();
  const transcript = options?.withoutTranscript ? "" : full;
  const lines = [
    "标题：" + video.title,
    "频道：" + (video.channel_title ?? ""),
    "简介：" + (video.description ?? "（没有简介）"),
  ];
  if (transcript === "") {
    lines.push(full === ""
      ? "字幕：这一期没有字幕，只有标题和简介。按标题和简介能读出来的内容写，不要编造细节。"
      : "字幕：这次没有用字幕，只按标题和简介能读出来的内容写，不要编造细节。");
  } else {
    lines.push("字幕（太长时截断）：");
    lines.push(transcript.slice(0, MAX_TRANSCRIPT));
  }
  return lines.join("\n");
}

/**
 * 失败也留一行记录：blocked 的以后不再被选中，failed 的下一轮照常重试。
 * 已经有成功分析的视频不会被失败记录覆盖（好分析不能被一次网络抖动抹掉）。
 */
async function recordFailure(videoId: string, error: unknown): Promise<void> {
  const status = statusForError(error);
  const message = errorSummary(error);
  if (status === "failed") {
    await sql`
      INSERT INTO youtube_analyses (video_id, summary_zh, key_points, topics, transcript_hash, model, prompt_version, status, last_error, updated_at)
      VALUES (${videoId}, '', ${sql.json([] as never)}::jsonb, ${sql.json([] as never)}::jsonb, null, null, ${PROMPT_VERSION}, 'failed', ${message}, now())
      ON CONFLICT (video_id) DO UPDATE SET
        status = 'failed',
        last_error = EXCLUDED.last_error,
        transcript_hash = NULL,
        updated_at = now()
      WHERE youtube_analyses.status IS DISTINCT FROM 'done'`;
    return;
  }
  await sql`
    INSERT INTO youtube_analyses (video_id, summary_zh, key_points, topics, transcript_hash, model, prompt_version, status, last_error, updated_at)
    VALUES (${videoId}, '', ${sql.json([] as never)}::jsonb, ${sql.json([] as never)}::jsonb, null, null, ${PROMPT_VERSION}, 'blocked', ${message}, now())
    ON CONFLICT (video_id) DO UPDATE SET
      summary_zh = '',
      key_points = '[]'::jsonb,
      topics = '[]'::jsonb,
      transcript_hash = NULL,
      status = 'blocked',
      last_error = EXCLUDED.last_error,
      updated_at = now()`;
}

/**
 * 分析一个视频并写进 youtube_analyses。字幕没变、已经有同一份分析时不动它，返回 false。
 * 内容侧拒收过的视频直接跳过，不再重试。
 * 模型回答不合法或者写库失败时抛出，由调用方记下；失败原因会先写进库里。
 */
export async function analyzeVideo(videoId: string): Promise<boolean> {
  const rows = await sql<(VideoRow & { channel_title: string | null })[]>`
    SELECT v.video_id, v.title, v.description, v.transcript, c.title AS channel_title
    FROM youtube_videos v
    JOIN youtube_channels c ON c.channel_id = v.channel_id
    WHERE v.video_id = ${videoId}`;
  const video = rows[0];
  if (!video) return false;

  const hash = contentHash(video);
  const existing = await sql<{ transcript_hash: string | null; status: string | null }[]>`
    SELECT transcript_hash, status FROM youtube_analyses WHERE video_id = ${videoId}`;
  // 内容侧拒收过的视频不再试：换一次模型输入它也不收。
  if (existing[0]?.status === "blocked") return false;
  if (existing[0]?.transcript_hash === hash) return false;

  const model = await modelFor("youtubeAnalyze");
  const call = (user: string) => chatJson({
    model,
    purpose: "youtube_analyze",
    subject: "youtube:" + videoId,
    promptVersion: PROMPT_VERSION,
    system: SYSTEM,
    user,
    schema: Output,
    temperature: 0.2,
    maxTokens: 2000,
  });
  let result: Awaited<ReturnType<typeof call>>;
  try {
    result = await call(buildUser(video)).catch((error: unknown) => {
      // 实测少数字幕会被模型服务的内容过滤挡下来（HTTP 422），这时只用标题和简介再试一次。
      const status = (error as { status?: number })?.status;
      if (status !== 422 || (video.transcript ?? "").trim() === "") throw error;
      return call(buildUser(video, { withoutTranscript: true }));
    });
  } catch (error) {
    // 先把失败写进库（blocked/failed），再把错误抛给调用方记日志。
    await recordFailure(videoId, error);
    throw error;
  }
  const data = clampLists(result.data);
  await sql`
    INSERT INTO youtube_analyses (video_id, summary_zh, key_points, topics, transcript_hash, model, prompt_version, status, last_error, updated_at)
    VALUES (${videoId}, ${data.summary_zh}, ${sql.json(data.key_points as never)}::jsonb, ${sql.json(data.topics as never)}::jsonb, ${hash}, ${result.model ?? model}, ${PROMPT_VERSION}, 'done', null, now())
    ON CONFLICT (video_id) DO UPDATE SET
      summary_zh = EXCLUDED.summary_zh,
      key_points = EXCLUDED.key_points,
      topics = EXCLUDED.topics,
      transcript_hash = EXCLUDED.transcript_hash,
      model = EXCLUDED.model,
      prompt_version = EXCLUDED.prompt_version,
      status = 'done',
      last_error = NULL,
      updated_at = now()`;
  return true;
}

/**
 * 分析还没分析过、或者内容变了（字幕换了）的视频。返回写进去的条数。
 * 一个视频失败不影响后面的，失败的原因写进日志，也写进库里的 status/last_error。
 * 被内容侧拒收（blocked）的视频不再被选中。
 */
export async function analyzePending(limit = limitFromEnv("YOUTUBE_ANALYZE_LIMIT")): Promise<number> {
  const rows = await sql<(VideoRow & { stored_hash: string | null })[]>`
    SELECT v.video_id, v.title, v.description, v.transcript, a.transcript_hash AS stored_hash
    FROM youtube_videos v
    LEFT JOIN youtube_analyses a ON a.video_id = v.video_id
    WHERE a.status IS DISTINCT FROM 'blocked'
    ORDER BY (a.video_id IS NULL) DESC, v.published_at DESC NULLS LAST
    LIMIT ${limit * 5}`;
  // 指纹一样说明内容没变，不用再问模型；剩下的才是真正要分析的。
  const pending = rows.filter((row) => row.stored_hash !== contentHash(row)).slice(0, limit);
  let count = 0;
  for (const row of pending) {
    try {
      const done = await analyzeVideo(row.video_id);
      if (done) count += 1;
    } catch (error) {
      console.error("youtube: 分析 " + row.video_id + " 失败", error);
    }
  }
  return count;
}
