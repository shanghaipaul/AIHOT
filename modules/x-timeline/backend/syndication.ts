// The embedded timeline of X: the only official endpoint that still answers when x.com itself is
// closed to this machine (Cloudflare turns every request away). syndication.twitter.com serves an
// account's public timeline as HTML whose __NEXT_DATA__ script holds the posts. This file reads it:
// the address, the parser and the fetch through the exit proxy.
import { ProxyAgent, fetch as undiciFetch } from "undici";

/** The browser a reader of x.com sends; the endpoint answers a browser, not a script. */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** How long one read waits before it gives up. */
const DEFAULT_TIMEOUT_MS = 20_000;

/** A picture or a video of a post. */
export interface SyndicationMedia {
  kind: "image" | "video";
  url: string;
  width: number | null;
  height: number | null;
  poster: string | null;
}

/** The post another post quotes. */
export interface SyndicationQuoted {
  authorName: string;
  handle: string;
  text: string;
  url: string;
  media: SyndicationMedia[];
}

/** One post of the timeline, as the endpoint states it. */
export interface SyndicationEntry {
  tweetId: string;
  text: string;
  createdAt: string | null;
  lang: string | null;
  replyTo: string | null;
  authorName: string;
  handle: string;
  avatarUrl: string | null;
  favorite: number | null;
  retweet: number | null;
  replyCount: number | null;
  media: SyndicationMedia[];
  quoted: SyndicationQuoted | null;
}

/** The account and its posts, as the endpoint states them. */
export interface SyndicationProfile {
  screenName: string | null;
  displayName: string | null;
  entries: SyndicationEntry[];
}

/** The address of an account's embedded timeline. */
export function syndicationUrl(handle: string): string {
  return `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}`;
}

type Json = Record<string, unknown>;

/** The named entities a post's text spells out. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  deg: "°",
  times: "×",
  divide: "÷",
  minus: "−",
  plusmn: "±",
  micro: "µ",
  para: "¶",
  sect: "§",
  dagger: "†",
  permil: "‰",
};

/** What an endpoint says when it has nothing: an account without posts is not an error. */
function emptyProfile(): SyndicationProfile {
  return { screenName: null, displayName: null, entries: [] };
}

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

/** A string field, as a string; a number that stands for a string (an id) becomes one. */
function stringOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** A number field, as a number; a number written as text becomes one. */
function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** The entities of a text, decoded once: a named one and a numeric one alike. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * The text of a post: the line breaks its markup carries become line breaks, and the entities it
 * spells out become the characters they name. The markup is read before the entities, so a post
 * that writes "&lt;br&gt;" keeps those as the text they are.
 */
function normalizeText(value: string): string {
  const withBreaks = value.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p\s*>/gi, "\n\n");
  return decodeEntities(withBreaks);
}

/** The mp4 of a video, when the post states one. */
function videoVariant(tweet: Json): string {
  const info = asObject(tweet.video_info);
  const variants = Array.isArray(info.variants) ? info.variants : [];
  let best = "";
  let bestRate = -1;
  for (const item of variants) {
    const one = asObject(item);
    const url = stringOf(one.url);
    if (!url) continue;
    const rate = numberOf(one.bitrate) ?? 0;
    if (rate > bestRate) {
      bestRate = rate;
      best = url;
    }
  }
  return best;
}

/** The pictures and videos of a post, in the order the post lists them. */
function parseMedia(value: unknown): SyndicationMedia[] {
  if (!Array.isArray(value)) return [];
  const media: SyndicationMedia[] = [];
  for (const item of value) {
    const one = asObject(item);
    const type = stringOf(one.type).toLowerCase();
    const image = stringOf(one.media_url_https) || stringOf(one.media_url);
    const video = stringOf(one.video_url) || videoVariant(one);
    const kind = type === "video" ? "video" : "image";
    const url = kind === "video" ? video || image : image || video;
    const poster = stringOf(one.poster) || (kind === "video" ? image || null : null);
    if (!url && !poster) continue;
    const sizes = asObject(one.original_sizes);
    const info = asObject(one.original_info);
    media.push({
      kind,
      url: url ?? "",
      width: numberOf(sizes.width) ?? numberOf(info.width),
      height: numberOf(sizes.height) ?? numberOf(info.height),
      poster: poster ?? null,
    });
  }
  return media;
}

/** The post a post quotes, when it quotes one. */
function parseQuoted(value: unknown): SyndicationQuoted | null {
  if (!value) return null;
  const one = asObject(value);
  const user = asObject(one.user);
  const tweetId = stringOf(one.id_str) || stringOf(one.id);
  const handle = stringOf(user.screen_name);
  const text = normalizeText(stringOf(one.full_text) || stringOf(one.text));
  if (!tweetId && !handle && !text) return null;
  return {
    authorName: stringOf(user.name),
    handle,
    text,
    url: tweetId && handle ? `https://x.com/${handle}/status/${tweetId}` : "",
    media: parseMedia(one.mediaDetails),
  };
}

/** One entry of the timeline, with every field the endpoint may leave out. */
function parseEntry(value: unknown): SyndicationEntry | null {
  const outer = asObject(value);
  const content = asObject(outer.content);
  const tweet = asObject(content.tweet ?? outer.tweet);
  if (!Object.keys(tweet).length) return null;
  const user = asObject(tweet.user);
  const quoted = parseQuoted(tweet.quoted_tweet ?? content.quoted_tweet ?? tweet.quoted_status ?? content.quoted_status);
  const mediaDetails = tweet.mediaDetails ?? content.mediaDetails ?? outer.mediaDetails;
  return {
    tweetId: stringOf(tweet.id_str) || stringOf(tweet.id),
    text: normalizeText(stringOf(tweet.full_text) || stringOf(tweet.text)),
    createdAt: stringOf(tweet.created_at) || null,
    lang: stringOf(tweet.lang) || null,
    replyTo: stringOf(tweet.in_reply_to_status_id_str) || null,
    authorName: stringOf(user.name),
    handle: stringOf(user.screen_name),
    avatarUrl: stringOf(user.profile_image_url_https) || null,
    favorite: numberOf(tweet.favorite_count),
    retweet: numberOf(tweet.retweet_count),
    replyCount: numberOf(tweet.conversation_count),
    media: parseMedia(mediaDetails),
    quoted,
  };
}

/**
 * The account and its posts, as the embedded page states them. The page carries them as JSON in a
 * __NEXT_DATA__ script; a page without that script, or with broken JSON, is an account this reader
 * cannot read, and it says so without throwing.
 */
export function parseSyndicationProfile(html: string): SyndicationProfile {
  if (typeof html !== "string" || !html) return emptyProfile();
  const found = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!found) return emptyProfile();
  let data: unknown;
  try {
    data = JSON.parse(found[1] ?? "");
  } catch {
    return emptyProfile();
  }
  const pageProps = asObject(asObject(asObject(data).props).pageProps);
  const header = asObject(pageProps.headerProps);
  const timeline = asObject(pageProps.timeline);
  const rawEntries = Array.isArray(timeline.entries) ? timeline.entries : [];
  const entries: SyndicationEntry[] = [];
  for (const raw of rawEntries) {
    const entry = parseEntry(raw);
    if (entry) entries.push(entry);
  }
  return {
    screenName: stringOf(header.screenName) || null,
    displayName: stringOf(header.name) || stringOf(header.displayName) || null,
    entries,
  };
}

/**
 * The account's timeline, read through the exit proxy. The status is the endpoint's own (429 when
 * the exit IP asked too often); the body is the raw text, kept for the trouble shots. Only a
 * transport failure (proxy down, timeout) throws: every answer the endpoint itself gives is
 * returned as it is.
 */
/** The one call the reader makes; a test can hand it a page instead of the network. */
export type ProfileFetcher = (
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ status: number; text: () => Promise<string> }>;

export async function fetchSyndicationProfile(
  handle: string,
  opts: { proxyUrl: string; timeoutMs?: number; userAgent?: string; fetchImpl?: ProfileFetcher },
): Promise<{ status: number; profile: SyndicationProfile; body: string }> {
  if (opts.fetchImpl) {
    const response = await opts.fetchImpl(syndicationUrl(handle), {
      headers: {
        "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const body = await response.text();
    return { status: response.status, profile: parseSyndicationProfile(body), body };
  }
  const agent = new ProxyAgent(opts.proxyUrl);
  try {
    const response = await undiciFetch(syndicationUrl(handle), {
      dispatcher: agent,
      headers: {
        "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const body = await response.text();
    return { status: response.status, profile: parseSyndicationProfile(body), body };
  } finally {
    await agent.close();
  }
}
