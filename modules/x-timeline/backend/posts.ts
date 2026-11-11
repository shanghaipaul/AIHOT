// The posts of the account, as they were collected: the newest first, each with its author, its
// media, the post it quotes and how hot it was. The engine's collector writes them; this file only
// reads them.
import { sql } from "@aihot/backend/db";
import { iso } from "./state.ts";
import type { XTimelineMedia, XTimelinePost, XTimelineQuoted } from "./types.ts";

/** A row of the articles table, as far as this module reads it. */
interface ArticleRow {
  id: string;
  url: string;
  title: string;
  excerpt: string | null;
  body_text: string | null;
  published_at: Date | string | null;
  language: string | null;
  x_post: unknown;
  raw: unknown;
}

/** The ids of the sources, as one list: the module has two rows and both hold posts. */
function idList(sourceIds: string | string[]): string[] {
  const list = Array.isArray(sourceIds) ? sourceIds : [sourceIds];
  return list.filter((id) => typeof id === "string" && id !== "");
}

/** How many posts the sources brought in since a moment: what the daily cap counts. */
export async function countXPostsSince(sourceIds: string | string[], since: Date): Promise<number> {
  const ids = idList(sourceIds);
  if (!ids.length) return 0;
  try {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM articles
      WHERE source_id IN ${sql(ids)} AND discovered_at >= ${since}`;
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

/** The posts of the sources, newest first. The limit is between 1 and 200. */
export async function loadXPosts(sourceIds: string | string[], limit = 50): Promise<XTimelinePost[]> {
  const ids = idList(sourceIds);
  const take = Math.max(1, Math.min(200, Math.trunc(limit) || 50));
  if (!ids.length) return [];
  try {
    const rows = await sql<ArticleRow[]>`
      SELECT id, url, title, excerpt, body_text, published_at, language, x_post, raw
      FROM articles
      WHERE source_id IN ${sql(ids)}
      ORDER BY published_at DESC NULLS LAST, discovered_at DESC
      LIMIT ${take}`;
    return rows.map(toPost);
  } catch {
    // The table is not there yet (the migrations have not run): the page shows nothing.
    return [];
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function media(value: unknown): XTimelineMedia[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const one = asObject(item);
      return {
        kind: text(one.kind) || "image",
        url: text(one.url),
        width: number(one.width),
        height: number(one.height),
        poster: text(one.poster) || null,
      };
    })
    .filter((one) => one.url !== "");
}

function quoted(value: unknown): XTimelineQuoted | null {
  const one = asObject(value);
  if (!Object.keys(one).length) return null;
  return {
    authorName: text(one.authorName),
    handle: text(one.handle),
    text: text(one.text),
    url: text(one.url),
    media: media(one.media),
  };
}

function toPost(row: ArticleRow): XTimelinePost {
  const x = asObject(row.x_post);
  const raw = asObject(row.raw);
  return {
    id: row.id,
    url: row.url,
    tweetId: text(x.tweetId) || null,
    title: row.title,
    text: text(x.text) || row.body_text || row.title,
    excerpt: row.excerpt ?? null,
    publishedAt: iso(row.published_at),
    lang: text(x.lang) || row.language || null,
    authorName: text(x.authorName),
    handle: text(x.handle),
    avatarUrl: text(x.avatarUrl) || null,
    media: media(x.media),
    quoted: quoted(x.quoted),
    replyTo: text(x.replyTo) || null,
    heat: {
      favorite: number(raw.favorite),
      retweet: number(raw.retweet),
      views: number(raw.views),
    },
  };
}
