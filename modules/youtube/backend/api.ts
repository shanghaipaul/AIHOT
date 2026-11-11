// 页面读的那份数据：频道、视频和它们的分析结果一次读出来。
// 表还没建好（迁移没跑）时返回空结构，页面照样能打开。
import { sql } from "@aihot/backend/db";
import type { YoutubeChannel, YoutubeFeed, YoutubeVideo } from "./types.ts";

/** 数据库里的一行，字段名和表里的列一一对应。 */
interface ChannelRow {
  channel_id: string;
  handle: string;
  title: string;
  category: string | null;
  enabled: boolean;
  last_fetched_at: Date | null;
  last_video_at: Date | null;
  video_count: number;
}

interface VideoRow {
  video_id: string;
  channel_id: string;
  channel_title: string;
  channel_handle: string;
  title: string;
  url: string;
  description: string | null;
  duration_seconds: number | null;
  view_count: number | null;
  published_at: Date | null;
  thumbnail: string | null;
  transcript_available: boolean;
  transcript_source: string | null;
  summary_zh: string | null;
  key_points: unknown;
  topics: unknown;
  analyzed_at: Date | null;
  updated_at: Date | null;
}

/** 时间统一写成 ISO 字符串，页面和接口拿到的格式一样。 */
function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** jsonb 里的数组，字段不在就当空数组。 */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * 读站点的视频列表：频道、视频和它们的分析结果。
 * channelId 给了就只看那个频道，否则看所有开着的频道；limit 限制视频条数。
 */
export async function loadYoutubeFeed(opts?: { channelId?: string; limit?: number }): Promise<YoutubeFeed> {
  const limit = opts?.limit ?? 50;
  const channelId = opts?.channelId ?? null;
  try {
    const channelRows = await sql<ChannelRow[]>`
      SELECT c.channel_id, c.handle, c.title, c.category, c.enabled, c.last_fetched_at, c.last_video_at,
        (SELECT count(*)::int FROM youtube_videos v WHERE v.channel_id = c.channel_id) AS video_count
      FROM youtube_channels c
      WHERE (${channelId}::text IS NULL AND c.enabled = true) OR c.channel_id = ${channelId}
      ORDER BY c.title`;
    const videoRows = await sql<VideoRow[]>`
      SELECT v.video_id, v.channel_id, c.title AS channel_title, c.handle AS channel_handle,
        v.title, v.url, v.description, v.duration_seconds, v.view_count, v.published_at, v.thumbnail,
        (v.transcript IS NOT NULL) AS transcript_available, v.transcript_source,
        a.summary_zh, a.key_points, a.topics, a.updated_at AS analyzed_at, v.updated_at
      FROM youtube_videos v
      JOIN youtube_channels c ON c.channel_id = v.channel_id
      LEFT JOIN youtube_analyses a ON a.video_id = v.video_id AND a.status IS DISTINCT FROM 'blocked'
      WHERE ${channelId}::text IS NULL OR v.channel_id = ${channelId}
      ORDER BY v.published_at DESC NULLS LAST
      LIMIT ${limit}`;

    const channels: YoutubeChannel[] = channelRows.map((row) => ({
      channelId: row.channel_id,
      handle: row.handle,
      title: row.title,
      category: row.category,
      enabled: row.enabled,
      lastFetchedAt: iso(row.last_fetched_at),
      lastVideoAt: iso(row.last_video_at),
      videoCount: Number(row.video_count ?? 0),
    }));

    const videos: YoutubeVideo[] = videoRows.map((row) => ({
      videoId: row.video_id,
      channelId: row.channel_id,
      channelTitle: row.channel_title,
      channelHandle: row.channel_handle,
      title: row.title,
      url: row.url,
      description: row.description,
      durationSeconds: row.duration_seconds,
      viewCount: row.view_count,
      publishedAt: iso(row.published_at),
      thumbnail: row.thumbnail,
      transcriptAvailable: Boolean(row.transcript_available),
      transcriptSource: row.transcript_source,
      summary: row.summary_zh || null,
      keyPoints: strings(row.key_points),
      topics: strings(row.topics),
      analyzedAt: iso(row.analyzed_at),
    }));

    const fetchedAt = channelRows.reduce<Date | null>((latest, row) => {
      const at = row.last_fetched_at;
      if (!at) return latest;
      const date = at instanceof Date ? at : new Date(at);
      return !latest || date > latest ? date : latest;
    }, null);
    const updatedAt = videoRows.reduce<Date | null>((latest, row) => {
      const at = row.updated_at;
      if (!at) return latest;
      const date = at instanceof Date ? at : new Date(at);
      return !latest || date > latest ? date : latest;
    }, null);

    return { channels, videos, fetchedAt: iso(fetchedAt), updatedAt: iso(updatedAt) };
  } catch {
    // 表还没有（迁移没跑）时，页面要拿到的是一个空的列表，不是一个错误。
    return { channels: [], videos: [], fetchedAt: null, updatedAt: null };
  }
}

/** 一条字幕归档，连视频的标题等信息；导出合订本时要用。 */
export interface SubtitleArchiveEntry {
  videoId: string;
  language: string;
  provider: string;
  fetchedAt: string;
  content: string;
  contentText: string;
  title: string;
  url: string;
  channelTitle: string;
  channelHandle: string;
  durationSeconds: number | null;
  publishedAt: string | null;
}

/** 归档表和视频表拼出来的一行。 */
interface SubtitleRow {
  video_id: string;
  language: string;
  provider: string;
  fetched_at: Date | null;
  content: string;
  content_text: string | null;
  title: string | null;
  url: string | null;
  channel_title: string | null;
  channel_handle: string | null;
  duration_seconds: number | null;
  published_at: Date | null;
}

/** 一行变一条归档记录。 */
function toSubtitleEntry(row: SubtitleRow): SubtitleArchiveEntry {
  return {
    videoId: row.video_id,
    language: row.language,
    provider: row.provider,
    fetchedAt: iso(row.fetched_at) ?? "",
    content: row.content ?? "",
    contentText: row.content_text ?? "",
    title: row.title ?? row.video_id,
    url: row.url ?? "https://www.youtube.com/watch?v=" + row.video_id,
    channelTitle: row.channel_title ?? "",
    channelHandle: row.channel_handle ?? "",
    durationSeconds: row.duration_seconds ?? null,
    publishedAt: iso(row.published_at),
  };
}

/** 秒数变时长：734 秒是 12:14。 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "";
  const total = Math.floor(seconds);
  if (!Number.isFinite(total) || total <= 0) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0 ? hours + ":" + pad(minutes) + ":" + pad(rest) : minutes + ":" + pad(rest);
}

/**
 * 读一个视频归档的字幕；没有就 null。
 * 表还没建好时也是 null，不是错误。
 */
export async function loadSubtitle(videoId: string): Promise<SubtitleArchiveEntry | null> {
  try {
    const rows = await sql<SubtitleRow[]>`
      SELECT s.video_id, s.language, s.provider, s.fetched_at, s.content, s.content_text,
        v.title, v.url, v.duration_seconds, v.published_at,
        c.title AS channel_title, c.handle AS channel_handle
      FROM youtube_subtitles s
      LEFT JOIN youtube_videos v ON v.video_id = s.video_id
      LEFT JOIN youtube_channels c ON c.channel_id = v.channel_id
      WHERE s.video_id = ${videoId}`;
    const row = rows[0];
    return row ? toSubtitleEntry(row) : null;
  } catch {
    return null;
  }
}

/** 读全部归档的字幕（连视频信息），导出合订本用；按发布时间从新到旧。 */
export async function loadSubtitleArchive(): Promise<SubtitleArchiveEntry[]> {
  try {
    const rows = await sql<SubtitleRow[]>`
      SELECT s.video_id, s.language, s.provider, s.fetched_at, s.content, s.content_text,
        v.title, v.url, v.duration_seconds, v.published_at,
        c.title AS channel_title, c.handle AS channel_handle
      FROM youtube_subtitles s
      LEFT JOIN youtube_videos v ON v.video_id = s.video_id
      LEFT JOIN youtube_channels c ON c.channel_id = v.channel_id
      ORDER BY v.published_at DESC NULLS LAST, s.video_id`;
    return rows.map(toSubtitleEntry);
  } catch {
    return [];
  }
}

/** 目录里的锚点：跟 GitHub 一样，把标点去掉、空格换成连字符。 */
function anchorFor(heading: string): string {
  return heading.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, "").replace(/\s+/g, "-");
}

/**
 * 字幕合订本（Markdown）：前面是目录，每篇含标题、频道、时长、原视频链接和纯文本全文。
 * 用户要的是"不用看视频"，所以正文就是字幕本身，一篇一段。
 */
export function renderArchiveMarkdown(entries: SubtitleArchiveEntry[], date: string): string {
  const lines: string[] = [];
  lines.push("# YouTube 字幕合订本 · " + date);
  lines.push("");
  lines.push("共 " + entries.length + " 篇，按发布时间从新到旧。字幕是机器生成的，可能有错字。");
  lines.push("");
  lines.push("## 目录");
  lines.push("");
  entries.forEach((entry, index) => {
    const heading = (index + 1) + ". " + entry.title;
    const when = entry.publishedAt ? entry.publishedAt.slice(0, 10) : "时间未知";
    const duration = formatDuration(entry.durationSeconds) || "时长未知";
    lines.push((index + 1) + ". [" + entry.title + "](#" + anchorFor(heading) + ") — " + entry.channelTitle + " · " + duration + " · " + when);
  });
  lines.push("");
  lines.push("---");
  for (const [index, entry] of entries.entries()) {
    lines.push("");
    lines.push("## " + (index + 1) + ". " + entry.title);
    lines.push("");
    lines.push("【标题】" + entry.title);
    lines.push("【频道】" + entry.channelHandle + (entry.channelTitle ? "（" + entry.channelTitle + "）" : ""));
    lines.push("【时长】" + (formatDuration(entry.durationSeconds) || "未知"));
    lines.push("【发布时间】" + (entry.publishedAt ?? "未知"));
    lines.push("【原视频链接】" + entry.url);
    lines.push("");
    lines.push(entry.contentText.trim());
  }
  return lines.join("\n");
}

/** 字幕合订本（纯文本）：同样的内容，不用 Markdown 标记。 */
export function renderArchiveText(entries: SubtitleArchiveEntry[]): string {
  const lines: string[] = [];
  for (const [index, entry] of entries.entries()) {
    lines.push("【标题】" + entry.title);
    lines.push("【频道】" + entry.channelHandle + (entry.channelTitle ? "（" + entry.channelTitle + "）" : ""));
    lines.push("【时长】" + (formatDuration(entry.durationSeconds) || "未知"));
    lines.push("【发布时间】" + (entry.publishedAt ?? "未知"));
    lines.push("【原视频链接】" + entry.url);
    lines.push("");
    lines.push(entry.contentText.trim());
    if (index < entries.length - 1) {
      lines.push("");
      lines.push("========================");
    }
  }
  return lines.join("\n");
}
