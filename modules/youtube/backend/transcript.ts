// 字幕：从 invidious 实例拿 WebVTT，清洗成纯文本再写回视频表。
// 直连 YouTube 的 timedtext 现在要 poToken，拿到的是空body，所以只走 invidious 这条路。
// 拿到的字幕还会归档：原始 vtt 和去掉时间轴的纯文本各存一份到 dataDir，页面和下载直接读它。
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { fetchJson, fetchText, invidiousInstances } from "./fetch.ts";

/** 字幕里常见的 HTML 实体，WebVTT 里这几个最常出现。 */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
};

/** 把实体还原成字符：命名实体查表，数字实体按码位算。 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    const key = body.toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[key] ?? match;
  });
}

/** 中日韩字符：它们之间不用空格，英文之间要空格，否则会粘成一个词。 */
function isCjk(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef);
}

/** 把一段段字幕接成一段话。 */
function joinPieces(pieces: string[]): string {
  let out = "";
  for (const piece of pieces) {
    if (out === "") {
      out = piece;
      continue;
    }
    const prev = out[out.length - 1];
    const next = piece[0];
    out += isCjk(prev) || isCjk(next) ? piece : " " + piece;
  }
  return out;
}

/**
 * 把 WebVTT 清洗成纯文本：去掉 WEBVTT 头、NOTE、序号行、时间行、标签和 HTML 实体，
 * 再把每条字幕接成一段。字幕是给模型看的正文，不要留时间戳和样式标签。
 */
export function parseVtt(vtt: string): string {
  const pieces: string[] = [];
  let inCue = false;
  for (const rawLine of vtt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      inCue = false;
      continue;
    }
    if (!inCue) {
      if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(line)) continue;
      if (/^\d+$/.test(line)) continue;
      if (line.includes("-->")) {
        inCue = true;
        continue;
      }
      if (/^[A-Za-z][A-Za-z-]*:/.test(line)) continue;
      continue;
    }
    const text = decodeEntities(line.replace(/<[^>]*>/g, "")).trim();
    if (text !== "") pieces.push(text);
  }
  return joinPieces(pieces);
}

/** 一条字幕轨：名字、语言代码，还有下载地址。 */
interface Caption {
  label: string;
  languageCode: string | null;
  url: string | null;
}

/**
 * 字幕轨的挑选顺序：简体中文最优，其次繁体和其它中文，最后才是英文。
 * 同一个视频常有"Chinese (Simplified)"、"Chinese (China)"、"Chinese (Hong Kong)"好几条，
 * 随便挑一条会出现繁体或者港台用词。
 */
function labelScore(caption: Caption): number {
  const text = (caption.label + " " + (caption.languageCode ?? "")).toLowerCase();
  if (/simplified|zh-hans|zh-cn|zh-sg|简体/.test(text)) return 0;
  if (/traditional|zh-hant|zh-tw|zh-hk|繁體|繁体/.test(text)) return 1;
  if (/chinese|mandarin|中文/.test(text)) return 2;
  if (/\bzh\b|^zh/.test(text)) return 3;
  if (/english|^en\b/.test(text)) return 4;
  return 5;
}

function parseCaptions(payload: unknown): Caption[] {
  // 实例返回的是 { captions: [...] }，但也容错直接给数组的形状。
  const wrapper = payload as { captions?: unknown } | null;
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(wrapper?.captions)
      ? wrapper.captions
      : [];
  const captions: Caption[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = typeof row.label === "string" ? row.label : typeof row.name === "string" ? row.name : "";
    if (label === "") continue;
    captions.push({
      label,
      languageCode: typeof row.languageCode === "string" ? row.languageCode : null,
      url: typeof row.url === "string" ? row.url : null,
    });
  }
  return captions;
}

/**
 * 实例的限流：一口气连着请求，列表接口会直接回空数组（实测连打 16 个请求全是空的，
 * 隔开 2.5 秒就稳定）。所以两次请求之间至少停一下，默认就按 2.5 秒来。
 */
const DEFAULT_GAP_MS = 2_500;

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 两次请求之间留出间隔，躲开实例的限流。 */
async function throttle(): Promise<void> {
  const gap = Number(process.env.YOUTUBE_CAPTION_GAP_MS ?? DEFAULT_GAP_MS);
  const wait = lastRequestAt + (Number.isFinite(gap) && gap > 0 ? gap : DEFAULT_GAP_MS) - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/** 实例的主机名：字幕来源记在视频表里，看得出来是哪一家给的。 */
function hostOf(instance: string): string {
  try {
    return new URL(instance).host;
  } catch {
    return instance;
  }
}

/**
 * 取一个视频的字幕。逐个实例试：有的实例只给列表不给字幕，
 * 所以列表和下载可以落在不同的实例上。取不到就返回 null。
 * 实测（2026-11）：实例给的字幕列表和观看页里的 captionTracks 是一致的，
 * 拿不到字幕是视频本身没有字幕，不是实例挑错了轨。
 * 拿到之后顺手归档：原始 vtt 和纯文本各存一份，页面和下载直接用。
 */
export async function fetchTranscript(videoId: string): Promise<{ text: string; lang: string; source: string } | null> {
  for (const instance of invidiousInstances()) {
    await throttle();
    const payload = await fetchJson(instance + "/api/v1/captions/" + videoId);
    const captions = parseCaptions(payload);
    if (captions.length === 0) continue;
    let picked = captions[0];
    let score = labelScore(picked);
    for (const caption of captions.slice(1)) {
      const value = labelScore(caption);
      if (value < score) {
        picked = caption;
        score = value;
      }
    }
    const url = picked.url
      ? picked.url.startsWith("http")
        ? picked.url
        : instance + picked.url
      : instance + "/api/v1/captions/" + videoId + "?label=" + encodeURIComponent(picked.label);
    await throttle();
    const vtt = await fetchText(url);
    if (!vtt) continue;
    const text = parseVtt(vtt);
    if (text.trim() === "") continue;
    const language = picked.languageCode ?? picked.label;
    // 归档失败不该拦住字幕入库：文件只是备份，表里的正文才是要紧的。
    await archiveSubtitle({ videoId, language, provider: hostOf(instance), rawVtt: vtt }).catch((error: unknown) => {
      console.error("youtube: 字幕归档 " + videoId + " 失败", error);
    });
    return { text, lang: language, source: hostOf(instance) };
  }
  return null;
}

/**
 * 失败后等一会儿再试一次要隔多久：实例被连着请求之后会回空列表，
 * 而空列表和"这期真没字幕"长得一模一样，只能停一下再试一次才能区分。
 */
const RETRY_GAP_MS = 2_500;

/**
 * 往前看多少天：0 表示不限。
 * 用户要的是全部字幕（不用去看视频），所以默认不限时间，历史缺字幕的也补；
 * YOUTUBE_TRANSCRIPT_WINDOW_DAYS 是安全阀，调小就只看最近的。
 */
export function windowDays(): number {
  const value = Number(process.env.YOUTUBE_TRANSCRIPT_WINDOW_DAYS ?? 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * 一次补多少条：0 表示不限（默认）。
 * 同上，用户要的是全部字幕；YOUTUBE_TRANSCRIPT_LIMIT 是安全阀，调小就是限量。
 */
export function transcriptLimit(): number {
  const value = Number(process.env.YOUTUBE_TRANSCRIPT_LIMIT ?? 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

// ------------------------------------------------------------------ 归档

/** 文件名里不能有的字符：路径分隔符和 Windows 那些保留字符。 */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * 文件名安全化：视频 id 和语言代码都是外面来的，
 * 去掉路径分隔符等非法字符，免得写到目录外面去。
 */
export function safeFilePart(value: string): string {
  const cleaned = value.replace(ILLEGAL_NAME_CHARS, "_").trim().replace(/\s+/g, "_").replace(/^\.+/, "").trim();
  return cleaned === "" ? "unknown" : cleaned.slice(0, 64);
}

/** 一条字幕归档落在哪儿：<data dir>/youtube/subtitles/<video>.<lang>.vtt。 */
export function subtitleFilePath(videoId: string, language: string, dataDir: string, ext: "vtt" | "txt" = "vtt"): string {
  return path.join(dataDir, "youtube", "subtitles", safeFilePart(videoId) + "." + safeFilePart(language) + "." + ext);
}

/** 纯文本那份字幕落在哪儿：同一个目录，扩展名是 txt。 */
export function subtitleTextFilePath(videoId: string, language: string, dataDir: string): string {
  return subtitleFilePath(videoId, language, dataDir, "txt");
}

/** 空字幕不归档：这个视频本来就没有字幕，留一条空记录没有意义。 */
export function subtitleContent(rawVtt: string): string | null {
  const content = rawVtt.trim();
  return content === "" ? null : content;
}

/** 去掉时间轴的纯文本；空输入给出 null。 */
export function subtitleText(rawVtt: string): string | null {
  const text = parseVtt(rawVtt);
  return text.trim() === "" ? null : text;
}

/** 过期线：now 往前推 days 天。 */
export function subtitleCutoff(days: number, now: Date = new Date()): Date {
  const limit = Number.isFinite(days) && days > 0 ? days : 90;
  return new Date(now.getTime() - limit * 24 * 60 * 60 * 1000);
}

/** 字幕过期了没有：纯函数，方便测试。 */
export function isSubtitleExpired(fetchedAt: Date | string, days: number, now: Date = new Date()): boolean {
  const at = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() < subtitleCutoff(days, now).getTime();
}

/** 时间统一写成 ISO 字符串。 */
function iso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/** 归档表的一行：原始 vtt 和去掉时间轴的纯文本都在里面。 */
export interface ArchivedSubtitle {
  videoId: string;
  language: string;
  provider: string;
  fetchedAt: string;
  content: string;
  contentText: string;
}

/**
 * 归档一条字幕：写 vtt、写纯文本、写表，再记下这个视频的字幕检查时间。
 * 字幕是空的就什么都不做，返回 null。
 */
export async function archiveSubtitle(input: {
  videoId: string;
  language: string;
  provider: string;
  rawVtt: string;
}): Promise<ArchivedSubtitle | null> {
  const content = subtitleContent(input.rawVtt);
  if (content === null) return null;
  const text = subtitleText(input.rawVtt) ?? "";
  const file = subtitleFilePath(input.videoId, input.language, config.dataDir);
  const textFile = subtitleTextFilePath(input.videoId, input.language, config.dataDir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  await writeFile(textFile, text, "utf8");
  let fetchedAt = new Date().toISOString();
  try {
    const rows = await sql<{ fetched_at: Date }[]>`
      INSERT INTO youtube_subtitles (video_id, language, provider, content, content_text, fetched_at)
      VALUES (${input.videoId}, ${input.language}, ${input.provider}, ${content}, ${text}, now())
      ON CONFLICT (video_id) DO UPDATE SET
        language = EXCLUDED.language,
        provider = EXCLUDED.provider,
        content = EXCLUDED.content,
        content_text = EXCLUDED.content_text,
        fetched_at = now()
      RETURNING fetched_at`;
    fetchedAt = iso(rows[0]?.fetched_at);
  } catch (error) {
    // 表还没建好或者写不进去时，文件已经落盘了，不算失败。
    console.error("youtube: 字幕归档入库 " + input.videoId + " 失败", error);
  }
  await markTranscriptChecked(input.videoId);
  return {
    videoId: input.videoId,
    language: input.language,
    provider: input.provider,
    fetchedAt,
    content,
    contentText: text,
  };
}

/** 读一条归档的字幕；没有就 null。 */
export async function fetchArchivedSubtitle(videoId: string): Promise<ArchivedSubtitle | null> {
  try {
    const rows = await sql<{
      video_id: string; language: string; provider: string; fetched_at: Date; content: string; content_text: string | null;
    }[]>`
      SELECT video_id, language, provider, fetched_at, content, content_text
      FROM youtube_subtitles WHERE video_id = ${videoId}`;
    const row = rows[0];
    if (!row) return null;
    return {
      videoId: row.video_id,
      language: row.language,
      provider: row.provider,
      fetchedAt: iso(row.fetched_at),
      content: row.content,
      contentText: row.content_text ?? "",
    };
  } catch {
    // 表还没有的时候只是没有字幕，不是错误。
    return null;
  }
}

/** 记下这个视频查过字幕（哪怕没有字幕），省得每轮都去问实例。 */
export async function markTranscriptChecked(videoId: string): Promise<void> {
  try {
    await sql`UPDATE youtube_videos SET transcript_checked_at = now() WHERE video_id = ${videoId}`;
  } catch {
    // 列还没有的时候不影响别的。
  }
}

/**
 * 清理超期的字幕文件：只删磁盘上的 vtt 和 txt，表里的正文留着。
 * 理由：用户要的是长期留档（不用去看视频），正文在库里能读能导出；
 * 删掉磁盘上的副本只是省地方，要删正文得另外一条命令。
 */
export async function purgeExpiredSubtitles(days = 90, now: Date = new Date()): Promise<number> {
  const cutoff = subtitleCutoff(days, now);
  try {
    const rows = await sql<{ video_id: string; language: string }[]>`
      SELECT video_id, language FROM youtube_subtitles WHERE fetched_at < ${cutoff}`;
    let purged = 0;
    for (const row of rows) {
      const files = [
        subtitleFilePath(row.video_id, row.language, config.dataDir),
        subtitleTextFilePath(row.video_id, row.language, config.dataDir),
      ];
      for (const file of files) {
        try {
          await rm(file);
          purged += 1;
        } catch {
          // 文件已经不在了，就当删过了。
        }
      }
    }
    return purged;
  } catch {
    // 表还没有的时候没有东西可清。
    return 0;
  }
}

/** 一次补字幕的结果：补上几条、失败几条、跳过几条、还剩几条。 */
export interface BackfillResult {
  filled: number;
  failed: number;
  skipped: number;
  remaining: number;
}


/**
 * 确认没有字幕的视频，多久再去问一次实例。
 * 默认 7 天：字幕有可能过几天才补上，但也别每轮都去打扰实例。
 */
export function subtitleRetryDays(): number {
  const value = Number(process.env.YOUTUBE_SUBTITLE_RETRY_DAYS ?? 7);
  if (!Number.isFinite(value) || value <= 0) return 7;
  return Math.floor(value);
}

/**
 * 把库里缺字幕的视频补齐：逐个视频去问实例。
 * 默认不限量也不限时间（用户要的是全部字幕），一次跑不完不报错，再触发一次接着跑。
 * 候选是"还没有归档字幕"的视频：正文早就有的也要再问一次，
 * 因为用户要的是落盘的文件（原始 vtt 和纯文本），不是库里那一段文字。
 */
export async function backfillSubtitles(limit = transcriptLimit()): Promise<BackfillResult> {
  const days = windowDays();
  const cap = limit > 0 ? limit : 100000;
  const retryDays = subtitleRetryDays();
  const rows = days > 0
    ? await sql<{ video_id: string }[]>`
        SELECT v.video_id FROM youtube_videos v
        LEFT JOIN youtube_subtitles s ON s.video_id = v.video_id
        WHERE s.video_id IS NULL
          AND (v.transcript_checked_at IS NULL OR v.transcript_checked_at < now() - ${retryDays} * interval '1 day')
          AND v.published_at > now() - ${days} * interval '1 day'
        ORDER BY v.published_at DESC NULLS LAST
        LIMIT ${cap}`
    : await sql<{ video_id: string }[]>`
        SELECT v.video_id FROM youtube_videos v
        LEFT JOIN youtube_subtitles s ON s.video_id = v.video_id
        WHERE s.video_id IS NULL
          AND (v.transcript_checked_at IS NULL OR v.transcript_checked_at < now() - ${retryDays} * interval '1 day')
        ORDER BY v.published_at DESC NULLS LAST
        LIMIT ${cap}`;
  let filled = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      let transcript = await fetchTranscript(row.video_id);
      // 第一次拿不到可能是实例在限流（列表接口会回空数组），停一下再试一次，
      // 两次都空才算这期真没字幕。
      if (!transcript) {
        await sleep(RETRY_GAP_MS);
        transcript = await fetchTranscript(row.video_id);
      }
      if (!transcript) {
        await markTranscriptChecked(row.video_id);
        skipped += 1;
        continue;
      }
      await sql`
        UPDATE youtube_videos
        SET transcript = ${transcript.text},
            transcript_source = ${transcript.source},
            transcript_lang = ${transcript.lang},
            transcript_checked_at = now(),
            updated_at = now()
        WHERE video_id = ${row.video_id}`;
      filled += 1;
    } catch (error) {
      // 一条视频出问题不能让整轮停掉，记下来继续下一条。
      failed += 1;
      console.error("youtube: 字幕补齐 " + row.video_id + " 失败", error);
    }
  }
  const rest = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM youtube_videos v
        LEFT JOIN youtube_subtitles s ON s.video_id = v.video_id
        WHERE s.video_id IS NULL
          AND (v.transcript_checked_at IS NULL OR v.transcript_checked_at < now() - ${retryDays} * interval '1 day')`;
  return { filled, failed, skipped, remaining: Number(rest[0]?.count ?? 0) };
}

/** 补字幕（定时任务用）：返回补上的条数。 */
export async function enrichTranscripts(limit = transcriptLimit()): Promise<number> {
  const result = await backfillSubtitles(limit);
  return result.filled;
}
