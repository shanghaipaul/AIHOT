// Reading the account's timeline through the embedded endpoint and writing what it brings in as
// material. The endpoint is the one that still answers when x.com itself is closed to this machine,
// but it counts every request that leaves through the exit address: a run that is told "too fast"
// says so plainly instead of passing for an account without posts.
import { sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import type { MaterialInput, MediaItem } from "@aihot/backend/content/materials";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { fetchSyndicationProfile } from "./syndication.ts";
import type { ProfileFetcher } from "./syndication.ts";
import type { SyndicationEntry, SyndicationMedia } from "./syndication.ts";

/** How many posts one run writes when the caller names no limit. */
const DEFAULT_LIMIT = 50;

/** The most one run writes. */
const MAX_LIMIT = 200;

/** How long until the source is read again when the caller says nothing. */
const DEFAULT_INTERVAL_MINUTES = 120;

/** How the last run went: what was found, what was new, what was left out, what went wrong. */
export interface SyndicationCollectResult {
  status: number;
  found: number;
  created: number;
  skipped: number;
  error: string | null;
}

/** The first line of a post's text: the title of the material. */
function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim()) ?? text;
}

/** When a post was written: the date the endpoint states, or null when it states none. */
function publishedDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** The pictures and videos of a post, as the material table keeps them. */
function toMedia(media: SyndicationMedia[]): MediaItem[] {
  return media.map((one) => ({
    kind: one.kind,
    url: one.url,
    width: one.width,
    height: one.height,
    poster: one.poster,
  }));
}

/** The material one post becomes: the post itself, its pictures and the post it quotes. */
function materialOf(sourceId: string, handle: string, entry: SyndicationEntry): MaterialInput {
  const name = (entry.handle || handle || "").replace(/^@/, "");
  const text = entry.text ?? "";
  const line = firstLine(text);
  const quoted = entry.quoted;
  return {
    sourceId,
    url: "https://x.com/" + name + "/status/" + entry.tweetId,
    title: line.length > 140 ? line.slice(0, 137) + "..." : line,
    identityKey: "x:" + entry.tweetId,
    author: name,
    language: entry.lang ?? null,
    publishedAt: publishedDate(entry.createdAt),
    bodyText: [text, quoted ? "\n\n【引用 @" + quoted.handle + "】" + quoted.text : ""].join("").trim(),
    bodyStatus: "ok",
    media: toMedia(entry.media),
    xPost: {
      tweetId: entry.tweetId,
      authorName: entry.authorName,
      handle: name,
      avatarUrl: entry.avatarUrl,
      text,
      lang: entry.lang ?? null,
      replyTo: entry.replyTo,
      media: toMedia(entry.media),
      quoted: quoted
        ? {
            authorName: quoted.authorName,
            handle: quoted.handle,
            text: quoted.text,
            url: quoted.url,
            media: toMedia(quoted.media),
          }
        : null,
    },
    raw: { favorite: entry.favorite, retweet: entry.retweet, views: null },
    via: "x-timeline",
  };
}

/** The source had a good run: it is healthy, and the next run is due after the interval. */
async function markSourceOk(sourceId: string, intervalMinutes: number): Promise<void> {
  try {
    await sql`
      UPDATE sources
      SET last_fetch_at = now(), last_ok_at = now(), health = 'ok', last_error = null,
          next_fetch_at = now() + (${intervalMinutes} * interval '1 minute')
      WHERE id = ${sourceId}`;
  } catch {
    // The row is not there (the migrations have not run): there is nothing to keep in step.
  }
}

/** The run failed: the reason is written down and the source is marked degraded. */
async function markSourceFailed(sourceId: string, message: string): Promise<void> {
  try {
    await sql`
      UPDATE sources
      SET last_fetch_at = now(), health = 'degraded', last_error = ${message}
      WHERE id = ${sourceId}`;
  } catch {
    // The row is not there: there is nothing to keep in step.
  }
}

/** The endpoint asked for less traffic: the source keeps its health, the reason is written down. */
async function markSourceLimited(sourceId: string, message: string): Promise<void> {
  try {
    await sql`
      UPDATE sources
      SET last_fetch_at = now(), last_error = ${message}
      WHERE id = ${sourceId}`;
  } catch {
    // The row is not there: there is nothing to keep in step.
  }
}

/**
 * Reads the account's embedded timeline and writes the posts it brings in as material.
 *
 * The endpoint counts every request of the exit address, so a run that is told "too fast" reports
 * that instead of pretending the account is empty. An account without public posts is not a
 * failure: it is an account whose timeline says nothing.
 */
export async function collectSyndication(opts: {
  sourceId: string;
  handle: string;
  proxyUrl: string;
  includeReplies?: boolean;
  limit?: number;
  fetchImpl?: ProfileFetcher;
}): Promise<SyndicationCollectResult> {
  if (!opts.proxyUrl) {
    return { status: 0, found: 0, created: 0, skipped: 0, error: "还没有配置代理地址" };
  }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(opts.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
  const includeReplies = opts.includeReplies ?? false;

  let response;
  try {
    response = await fetchSyndicationProfile(opts.handle, { proxyUrl: opts.proxyUrl, fetchImpl: opts.fetchImpl });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markSourceFailed(opts.sourceId, reason);
    return { status: 0, found: 0, created: 0, skipped: 0, error: "读取 X 时间线失败：" + reason };
  }

  const status = response.status;
  if (status === 429) {
    const message = "X 限流（429），同一个出口 IP 请求太频繁，请过一会儿再试";
    await markSourceLimited(opts.sourceId, message);
    return { status, found: 0, created: 0, skipped: 0, error: message };
  }
  if (status !== 200) {
    const message = "读取 X 时间线失败（HTTP " + status + "）";
    await markSourceFailed(opts.sourceId, message);
    return { status, found: 0, created: 0, skipped: 0, error: message };
  }

  const entries = response.profile.entries ?? [];
  const found = entries.length;
  let skipped = 0;
  let created = 0;

  const wanted: SyndicationEntry[] = [];
  for (const entry of entries) {
    // A reply is another conversation, not the account's own timeline, and a post without an id
    // cannot be stored or found again.
    if ((!includeReplies && entry.replyTo) || !entry.tweetId) {
      skipped += 1;
      continue;
    }
    wanted.push(entry);
  }
  const taken = wanted.slice(0, limit);
  skipped += wanted.length - taken.length;

  try {
    for (const entry of taken) {
      const result = await upsertMaterial(materialOf(opts.sourceId, opts.handle, entry));
      if (result.created) created += 1;
      // The material only becomes a post when it is handed to the processing queue. The source is
      // isolated, so the queue settles it without asking a model anything.
      if (result.created || result.revised || result.processingNeeded) await queueProcessing(result.articleId);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markSourceFailed(opts.sourceId, "写入素材失败：" + reason);
    return { status, found, created, skipped, error: "写入素材失败：" + reason };
  }

  await markSourceOk(opts.sourceId, DEFAULT_INTERVAL_MINUTES);
  return { status, found, created, skipped, error: null };
}
