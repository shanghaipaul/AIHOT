// 采集频道里的视频。YouTube 的频道 RSS 早已 404，所以列表读 invidious 实例的接口（时间、播放量），
// 频道页补标题和时长，观看页补发布时间和简介；三个来源互为兜底，任何一个挂了都不影响别的。
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { YOUTUBE_CHANNELS, ensureChannels } from "./channels.ts";

/** 采集时用的 User-Agent：站点自己的名字和地址，YouTube 对普通浏览器的 UA 收得更紧。 */
export const YOUTUBE_UA = "Mozilla/5.0 (compatible; AIRibaoBot/1.0; +http://localhost:30001/about)";

/**
 * invidious 实例：列表接口取第一个能用的，字幕下载要能换实例（有的实例只给列表不给字幕）。
 * 2026-11 实测过一批公共实例，只有这两个可用：inv.tux.pizza、invidious.privacyredirect.com、
 * iv.melmac.space、id.420129.xyz、invidious.fdn.fr、invidious.jing.rocks、invidious.nerdvpn.de、
 * invidious.einfachzocken.eu 都是超时或空，invidious.protokolla.fi 是验证码页面。
 * 注意 inv.nadeko.net 认不认请求方：带站点的 UA 才有 JSON，别的 UA 会拿到挑战页。
 */
const DEFAULT_INSTANCES = "https://yt.chocolatemoo53.com,https://inv.nadeko.net";

/** 一个频道一轮读多少条。 */
const DEFAULT_VIDEOS_PER_CHANNEL = 12;

/** 频道页和观看页都有一兆多，2 MB 够用，再多就截断。 */
const MAX_BYTES = 2_000_000;

/** 读完的实例列表，逗号分隔。 */
export function invidiousInstances(): string[] {
  const raw = process.env.YOUTUBE_INVIDIOUS_INSTANCES?.trim() || DEFAULT_INSTANCES;
  return raw.split(",").map((part) => part.trim().replace(/\/+$/, "")).filter(Boolean);
}

/** 一个频道一轮读多少条视频。 */
export function videosPerChannel(): number {
  const value = Number(process.env.YOUTUBE_VIDEOS_PER_CHANNEL ?? DEFAULT_VIDEOS_PER_CHANNEL);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_VIDEOS_PER_CHANNEL;
}

/** 一轮补多少条：环境变量说了算，写错或者没写就回落默认。 */
export function limitFromEnv(name: string, fallback = 5): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** 读一个地址；不是 200 或者读不到，就当它没有。 */
export async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await guardedFetch(url, {
      headers: { "user-agent": YOUTUBE_UA },
      timeoutMs: 30_000,
      maxBytes: MAX_BYTES,
      truncate: true,
    });
    if (response.status !== 200) return null;
    return response.text();
  } catch {
    return null;
  }
}

/** 读一个地址并当 JSON 解析；页面不是 JSON 时当作没有。 */
export async function fetchJson(url: string): Promise<unknown> {
  const text = await fetchText(url);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/**
 * 页面里 ytInitialData 后面跟着一段 JSON，它的字符串里也有大括号，所以按括号配平截取，
 * 不能靠数括号，也不能靠第一个 "}"。
 */
export function extractInitialJson(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  let start = at + marker.length;
  while (start < html.length && (html[start] === " " || html[start] === "\n" || html[start] === "\t")) start += 1;
  if (html[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** "12:14" 是 734 秒，"1:02:03" 是 3723 秒；写不出来就没有时长。 */
export function durationToSeconds(text: string | null | undefined): number | null {
  if (!text) return null;
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    const piece = part.trim();
    if (!/^\d+$/.test(piece)) return null;
    seconds = seconds * 60 + Number(piece);
  }
  return seconds;
}

/** 频道页上的一条视频：标题和时长在这里，发布时间和播放量没有。 */
export interface ChannelVideo {
  videoId: string;
  title: string | null;
  durationSeconds: number | null;
  thumbnail: string | null;
}

/**
 * 读频道页的 Videos 标签页。默认选中的标签是 Home，所以要显式找 Videos；
 * 里面每条视频是 richItemRenderer.content.lockupViewModel。
 */
export function parseChannelPage(html: string): ChannelVideo[] {
  const data = obj(extractInitialJson(html, "ytInitialData = "));
  const tabs = arr(obj(obj(data?.contents)?.twoColumnBrowseResultsRenderer)?.tabs);
  const videosTab = tabs.find((tab) => str(obj(obj(tab)?.tabRenderer)?.title) === "Videos");
  const contents = arr(obj(obj(obj(obj(videosTab)?.tabRenderer)?.content)?.richGridRenderer)?.contents);
  const videos: ChannelVideo[] = [];
  for (const item of contents) {
    const lockup = obj(obj(obj(obj(item)?.richItemRenderer)?.content)?.lockupViewModel);
    const videoId = str(lockup?.contentId);
    if (!videoId) continue;
    const title = str(obj(obj(obj(lockup?.metadata)?.lockupMetadataViewModel)?.title)?.content);
    const overlays = arr(obj(obj(lockup?.contentImage)?.thumbnailViewModel)?.overlays);
    const bottom = obj(obj(overlays[0])?.thumbnailBottomOverlayViewModel);
    const badges = arr(bottom?.badges);
    const badge = str(obj(obj(badges[0])?.thumbnailBadgeViewModel)?.text);
    const sources = arr(obj(obj(obj(lockup?.contentImage)?.thumbnailViewModel)?.image)?.sources);
    videos.push({
      videoId,
      title,
      durationSeconds: durationToSeconds(badge),
      thumbnail: str(obj(sources[0])?.url),
    });
  }
  return videos;
}

/** invidious 的一条视频：这里才有发布时间和播放量。 */
interface InvidiousVideo {
  videoId: string;
  title: string | null;
  description: string | null;
  published: Date | null;
  viewCount: number | null;
  lengthSeconds: number | null;
}

function parseInvidiousVideos(payload: unknown): InvidiousVideo[] {
  const videos: InvidiousVideo[] = [];
  for (const item of arr(obj(payload)?.videos)) {
    const row = obj(item);
    const videoId = str(row?.videoId);
    if (!videoId) continue;
    const epoch = num(row?.published);
    const views = num(row?.viewCount);
    const length = num(row?.lengthSeconds);
    videos.push({
      videoId,
      title: str(row?.title),
      description: str(row?.description),
      published: epoch !== null ? new Date(epoch * 1000) : null,
      viewCount: views,
      lengthSeconds: length,
    });
  }
  return videos;
}

/** 频道的清单里那一行：handle 和标题从这里来。 */
function seedOf(channelId: string): (typeof YOUTUBE_CHANNELS)[number] | undefined {
  return YOUTUBE_CHANNELS.find((seed) => seed.channelId === channelId);
}

/** invidious 的列表接口：第一个能用的实例胜出，全挂就返回空列表。 */
async function readInvidious(channelId: string, limit: number): Promise<InvidiousVideo[]> {
  for (const instance of invidiousInstances()) {
    const payload = await fetchJson(`${instance}/api/v1/channels/${channelId}/videos?sort_by=newest`);
    const videos = parseInvidiousVideos(payload);
    if (videos.length > 0) return videos.slice(0, limit);
  }
  return [];
}

/** 频道页：标题和时长在这里，invidious 全挂时它是唯一的来源。 */
async function readChannelPage(handle: string): Promise<ChannelVideo[]> {
  const html = await fetchText(`https://www.youtube.com/${handle}/videos`);
  if (html === null) return [];
  return parseChannelPage(html);
}

/** 观看页：发布时间和简介在这里（invidious 的简介多半是空的）。 */
export interface WatchInfo {
  title: string | null;
  description: string | null;
  viewCount: number | null;
  lengthSeconds: number | null;
  publishedAt: Date | null;
}

export function parseWatchPage(html: string): WatchInfo | null {
  const data = obj(extractInitialJson(html, "ytInitialPlayerResponse = "));
  if (!data) return null;
  const details = obj(data.videoDetails);
  const micro = obj(obj(data.microformat)?.playerMicroformatRenderer);
  const publishDate = str(micro?.publishDate);
  const published = publishDate ? new Date(publishDate) : null;
  return {
    title: str(details?.title),
    description: str(details?.shortDescription),
    viewCount: num(details?.viewCount),
    lengthSeconds: num(details?.lengthSeconds),
    publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
  };
}

/** 读一个视频的观看页。 */
async function readWatchPage(videoId: string): Promise<WatchInfo | null> {
  const html = await fetchText(`https://www.youtube.com/watch?v=${videoId}`);
  if (html === null) return null;
  return parseWatchPage(html);
}

/** 视频的固定链接和缩略图：YouTube 自己的地址，频道页读到的缩略图优先。 */
function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function videoThumbnail(videoId: string, thumbnail: string | null): string {
  return thumbnail ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** 一个频道一轮读到的视频，三个来源合在一起的样子。 */
interface CollectedVideo {
  videoId: string;
  title: string | null;
  description: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  publishedAt: Date | null;
  thumbnail: string | null;
}

/**
 * 读一个频道，写它这轮的视频。返回读到的条数和新出现的条数：
 * 已经有的视频只补上缺的东西（标题、时长、播放量、发布时间），字幕和分析结果不动。
 */
export async function collectChannel(channelId: string): Promise<{ channelId: string; found: number; newVideos: number }> {
  await ensureChannels();
  const seed = seedOf(channelId);
  const limit = videosPerChannel();

  const invidious = await readInvidious(channelId, limit);
  const page = seed ? await readChannelPage(seed.handle) : [];

  const merged = new Map<string, CollectedVideo>();
  for (const item of invidious) {
    merged.set(item.videoId, {
      videoId: item.videoId,
      title: item.title,
      description: item.description,
      durationSeconds: item.lengthSeconds,
      viewCount: item.viewCount,
      publishedAt: item.published,
      thumbnail: null,
    });
  }
  for (const item of page) {
    const known = merged.get(item.videoId);
    if (known) {
      known.title = known.title ?? item.title;
      known.durationSeconds = known.durationSeconds ?? item.durationSeconds;
      known.thumbnail = item.thumbnail;
    } else {
      merged.set(item.videoId, {
        videoId: item.videoId,
        title: item.title,
        description: null,
        durationSeconds: item.durationSeconds,
        viewCount: null,
        publishedAt: null,
        thumbnail: item.thumbnail,
      });
    }
  }

  const videos = [...merged.values()].filter((item) => item.title !== null).slice(0, limit);
  const ids = videos.map((item) => item.videoId);
  const knownIds = new Set<string>();
  if (ids.length > 0) {
    const rows = await sql<{ video_id: string }[]>`SELECT video_id FROM youtube_videos WHERE video_id = ANY(${ids})`;
    for (const row of rows) knownIds.add(row.video_id);
  }

  let newVideos = 0;
  let newest: Date | null = null;
  for (const item of videos) {
    const title = item.title!;
    if (!knownIds.has(item.videoId)) newVideos += 1;
    if (item.publishedAt && (!newest || item.publishedAt > newest)) newest = item.publishedAt;
    await sql`
      INSERT INTO youtube_videos (video_id, channel_id, title, url, description, duration_seconds, view_count, published_at, thumbnail, updated_at)
      VALUES (${item.videoId}, ${channelId}, ${title}, ${videoUrl(item.videoId)}, ${item.description}, ${item.durationSeconds}, ${item.viewCount}, ${item.publishedAt}, ${videoThumbnail(item.videoId, item.thumbnail)}, now())
      ON CONFLICT (video_id) DO UPDATE SET
        title = EXCLUDED.title,
        url = EXCLUDED.url,
        description = COALESCE(EXCLUDED.description, youtube_videos.description),
        duration_seconds = COALESCE(EXCLUDED.duration_seconds, youtube_videos.duration_seconds),
        view_count = COALESCE(EXCLUDED.view_count, youtube_videos.view_count),
        published_at = COALESCE(EXCLUDED.published_at, youtube_videos.published_at),
        thumbnail = COALESCE(EXCLUDED.thumbnail, youtube_videos.thumbnail),
        updated_at = now()`;
  }

  await sql`
    UPDATE youtube_channels
    SET last_fetched_at = now(), last_video_at = COALESCE(${newest}, last_video_at), updated_at = now()
    WHERE channel_id = ${channelId}`;

  return { channelId, found: videos.length, newVideos };
}

/**
 * 观看页补发布时间和简介。一轮最多补几条（缺发布时间的先补，其余按新的先补），
 * 免得一次跑下来发几十个请求。
 */
export async function enrichWatchPages(limit = limitFromEnv("YOUTUBE_ENRICH_LIMIT")): Promise<number> {
  const rows = await sql<{ video_id: string }[]>`SELECT video_id FROM youtube_videos
    WHERE published_at IS NULL OR description IS NULL
    ORDER BY published_at DESC, first_seen_at DESC
    LIMIT ${limit}`;
  let filled = 0;
  for (const row of rows) {
    const info = await readWatchPage(row.video_id);
    if (!info) continue;
    await sql`
      UPDATE youtube_videos
      SET published_at = COALESCE(published_at, ${info.publishedAt}),
          description = COALESCE(description, ${info.description}),
          duration_seconds = COALESCE(duration_seconds, ${info.lengthSeconds}),
          view_count = COALESCE(view_count, ${info.viewCount}),
          title = COALESCE(NULLIF(title, ''), ${info.title}),
          updated_at = now()
      WHERE video_id = ${row.video_id}`;
    filled += 1;
  }
  return filled;
}

/**
 * 读所有开着的频道。一个频道失败不影响别的频道，失败的原因写进日志。
 * 一轮读完后用观看页补一次新视频的发布时间和简介。
 */
export async function collectAll(): Promise<{ channels: number; found: number; newVideos: number }> {
  await ensureChannels();
  let channels = 0;
  let found = 0;
  let newVideos = 0;
  for (const seed of YOUTUBE_CHANNELS) {
    if (seed.enabled === false) continue;
    try {
      const result = await collectChannel(seed.channelId);
      channels += 1;
      found += result.found;
      newVideos += result.newVideos;
    } catch (error) {
      console.error(`youtube: 频道 ${seed.handle} 读取失败`, error);
    }
  }
  await enrichWatchPages();
  return { channels, found, newVideos };
}




