// 字幕：从 invidious 实例拿 WebVTT，清洗成纯文本再写回视频表。
// 直连 YouTube 的 timedtext 现在要 poToken，拿到的是空body，所以只走 invidious 这条路。
import { sql } from "@aihot/backend/db";
import { fetchJson, fetchText, invidiousInstances, limitFromEnv } from "./fetch.ts";

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
    return { text, lang: picked.languageCode ?? picked.label, source: hostOf(instance) };
  }
  return null;
}

/**
 * 失败后等一会儿再试一次要隔多久：实例被连着请求之后会回空列表，
 * 而空列表和"这期真没字幕"长得一模一样，只能停一下再试一次才能区分。
 */
const RETRY_GAP_MS = 2_500;

/**
 * 往前看多少天：默认一周，只补最近的新视频；补历史的时候把
 * YOUTUBE_TRANSCRIPT_WINDOW_DAYS 调大（频道一周不一定发 12 条，一周窗口常常是空的）。
 */
export function windowDays(): number {
  const value = Number(process.env.YOUTUBE_TRANSCRIPT_WINDOW_DAYS ?? 7);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 7;
}

export async function enrichTranscripts(limit = limitFromEnv("YOUTUBE_TRANSCRIPT_LIMIT")): Promise<number> {
  const days = windowDays();
  const rows = await sql<{ video_id: string }[]>`SELECT video_id FROM youtube_videos
    WHERE transcript IS NULL AND published_at > now() - ${days} * interval '1 day'
    ORDER BY published_at DESC
    LIMIT ${limit}`;
  let count = 0;
  for (const row of rows) {
    try {
      let transcript = await fetchTranscript(row.video_id);
      // 第一次拿不到可能是实例在限流（列表接口会回空数组），停一下再试一次，
      // 两次都空才算这期真没字幕。
      if (!transcript) {
        await sleep(RETRY_GAP_MS);
        transcript = await fetchTranscript(row.video_id);
      }
      if (!transcript) continue;
      await sql`
        UPDATE youtube_videos
        SET transcript = ${transcript.text},
            transcript_source = ${transcript.source},
            transcript_lang = ${transcript.lang},
            updated_at = now()
        WHERE video_id = ${row.video_id}`;
      count += 1;
    } catch (error) {
      // 一条视频出问题不能让整轮停掉，记下来继续下一条。
      console.error("youtube: 字幕补齐 " + row.video_id + " 失败", error);
    }
  }
  return count;
}
