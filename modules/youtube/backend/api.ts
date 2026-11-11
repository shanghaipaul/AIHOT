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
