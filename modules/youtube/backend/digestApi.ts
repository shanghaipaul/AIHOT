// 字幕精华提炼的读取与拼装：把 youtube_digests 里的行整理成页面要的形状，
// 再拼一份纯文本供下载。提炼本身在 backend/digest.ts 里，这里只读不写。
import { sql } from "@aihot/backend/db";
import { loadDigests, type DigestRow } from "./digest.ts";

/** 一条关键数据：指标名、数值、说明。 */
export interface DigestDataPoint {
  label: string;
  value: string;
  note: string;
}

/** 一个名词：产品、模型、公司。 */
export interface DigestEntity {
  name: string;
  note: string;
}

/** 页面读到的一条提炼。 */
export interface DigestItem {
  videoId: string;
  channelId: string | null;
  channelTitle: string | null;
  title: string;
  url: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  oneLiner: string;
  summary: string;
  keyPoints: string[];
  dataPoints: DigestDataPoint[];
  entities: DigestEntity[];
  audience: string;
  caveats: string[];
  model: string | null;
  updatedAt: string | null;
}

/** 有多少视频能提炼、提炼了多少、还差多少。 */
export interface DigestStats {
  total: number;
  done: number;
  blocked: number;
  pending: number;
}

/** 接口返回的整体。 */
export interface DigestFeed {
  digests: DigestItem[];
  stats: DigestStats;
}

/** jsonb 里的数组不一定真是数组，统一收成字符串数组。 */
export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter((item) => item !== "");
}

/** jsonb 里的关键数据：字段可能缺，补成空串，页面就不会渲染出 undefined。 */
export function asDataPoints(value: unknown): DigestDataPoint[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      label: String(row.label ?? ""),
      value: String(row.value ?? ""),
      note: String(row.note ?? ""),
    };
  });
}

/** jsonb 里的名词表。 */
export function asEntities(value: unknown): DigestEntity[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      name: String(row.name ?? ""),
      note: String(row.note ?? ""),
    };
  });
}

/** 视频链接统一在这里拼，别处不要自己拼。 */
export function digestUrl(videoId: string): string {
  return "https://www.youtube.com/watch?v=" + videoId;
}

/** 时间统一写成 ISO 字符串；读不出来就给 null。 */
export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 一行库记录变成一条接口数据。 */
export function toDigestItem(row: DigestRow): DigestItem {
  return {
    videoId: row.video_id,
    channelId: row.channel_id ?? null,
    channelTitle: row.channel_title ?? null,
    title: (row.title ?? row.video_id).trim(),
    url: digestUrl(row.video_id),
    durationSeconds: row.duration_seconds ?? null,
    publishedAt: toIso(row.published_at),
    oneLiner: (row.one_liner ?? "").trim(),
    summary: (row.summary_zh ?? "").trim(),
    keyPoints: asStringList(row.key_points),
    dataPoints: asDataPoints(row.data_points),
    entities: asEntities(row.entities),
    audience: (row.audience ?? "").trim(),
    caveats: asStringList(row.caveats),
    model: row.model ?? null,
    updatedAt: toIso(row.updated_at),
  };
}

/** 统计：还有多少没提炼（不会算出负数）。 */
export function digestStats(total: number, done: number, blocked: number): DigestStats {
  const safeTotal = Math.max(0, Math.trunc(total));
  const safeDone = Math.max(0, Math.trunc(done));
  const safeBlocked = Math.max(0, Math.trunc(blocked));
  return {
    total: safeTotal,
    done: safeDone,
    blocked: safeBlocked,
    pending: Math.max(0, safeTotal - safeDone - safeBlocked),
  };
}

/** 视频表里的标题与频道：提炼表里这两列常常是空的，读的时候补上。 */
export interface DigestVideoFields {
  video_id: string;
  title: string | null;
  channel_id: string | null;
  channel_title: string | null;
}

/**
 * 提炼表只存了提炼结果，标题和频道名要从视频表补；
 * 提炼表里已经有的值优先，缺的才补。
 */
export function mergeVideoFields(rows: DigestRow[], videos: DigestVideoFields[]): DigestRow[] {
  const byId = new Map(videos.map((video) => [video.video_id, video]));
  return rows.map((row) => {
    const video = byId.get(row.video_id);
    if (!video) return row;
    return {
      ...row,
      channel_id: row.channel_id ?? video.channel_id,
      channel_title: row.channel_title ?? video.channel_title,
      title: row.title ?? video.title,
    };
  });
}

/** 读所有提炼好的行；表还没建好时给空数组，页面不至于报错。 */
export async function loadDigestRows(): Promise<DigestRow[]> {
  try {
    const rows = await loadDigests();
    if (rows.length === 0) return rows;
    const ids = rows.map((row) => row.video_id);
    const videos = await sql<DigestVideoFields[]>`
      SELECT v.video_id, v.title, v.channel_id, c.title AS channel_title
      FROM youtube_videos v
      LEFT JOIN youtube_channels c ON c.channel_id = v.channel_id
      WHERE v.video_id = ANY(${ids})`;
    return mergeVideoFields(rows, videos);
  } catch {
    return [];
  }
}

/** 统计：有字幕的视频一共多少、提炼了多少、卡住多少。 */
export async function loadDigestStats(): Promise<DigestStats> {
  try {
    const rows = await sql<{ total: number; done: number; blocked: number }[]>`
      SELECT
        (SELECT count(*)::int FROM youtube_videos v
          JOIN youtube_subtitles s ON s.video_id = v.video_id
          WHERE s.content_text IS NOT NULL AND s.content_text <> '') AS total,
        (SELECT count(*)::int FROM youtube_digests WHERE status = 'done') AS done,
        (SELECT count(*)::int FROM youtube_digests WHERE status = 'blocked') AS blocked`;
    const row = rows[0];
    return digestStats(row?.total ?? 0, row?.done ?? 0, row?.blocked ?? 0);
  } catch {
    return digestStats(0, 0, 0);
  }
}

/** 页面读的整体：条目加统计。 */
export async function loadDigestFeed(): Promise<DigestFeed> {
  const [rows, stats] = await Promise.all([loadDigestRows(), loadDigestStats()]);
  return { digests: rows.map(toDigestItem), stats };
}

/** 纯文本合订本：标题、结论、摘要、要点、关键数据、名词、适合谁、注意事项，空行分段。 */
export function renderDigestsText(rows: DigestRow[]): string {
  const out: string[] = [];
  rows.forEach((row, index) => {
    const title = (row.title ?? row.video_id).trim();
    if (index > 0) out.push("");
    out.push((index + 1) + ". " + title);
    out.push("频道：" + (row.channel_title ?? "") + "  原视频：" + digestUrl(row.video_id));
    const oneLiner = (row.one_liner ?? "").trim();
    if (oneLiner !== "") {
      out.push("");
      out.push("结论：" + oneLiner);
    }
    const summary = (row.summary_zh ?? "").trim();
    if (summary !== "") {
      out.push("");
      out.push("摘要：" + summary);
    }
    const points = asStringList(row.key_points);
    if (points.length > 0) {
      out.push("");
      out.push("要点：");
      points.forEach((item) => out.push("- " + item));
    }
    const dataPoints = asDataPoints(row.data_points);
    if (dataPoints.length > 0) {
      out.push("");
      out.push("关键数据：");
      dataPoints.forEach((item) => out.push("- " + item.label + "：" + item.value + (item.note ? "（" + item.note + "）" : "")));
    }
    const entities = asEntities(row.entities);
    if (entities.length > 0) {
      out.push("");
      out.push("名词：");
      entities.forEach((item) => out.push("- " + item.name + (item.note ? "：" + item.note : "")));
    }
    const audience = (row.audience ?? "").trim();
    if (audience !== "") {
      out.push("");
      out.push("适合谁：" + audience);
    }
    const caveats = asStringList(row.caveats);
    if (caveats.length > 0) {
      out.push("");
      out.push("注意事项：");
      caveats.forEach((item) => out.push("- " + item));
    }
  });
  out.push("");
  return out.join("\n");
}
