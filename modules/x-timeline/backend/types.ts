// What the module's api answers with: the state of the timeline (what is configured, what the
// collector has found) and one post. The frontend reads these; the backend fills them.

/** How the module collects: the paid api the engine already has, or a login cookie (not wired yet). */
export type XTimelineMode = "socialdata" | "cookie";

/** A row of the sources table, as far as this module reads it. */
export interface XSourceRow {
  id: string;
  name: string;
  kind: string;
  config: Record<string, unknown> | null;
  tier: string;
  participation_mode: string;
  interval_minutes: number;
  enabled: boolean;
  health: string | null;
  last_fetch_at: Date | string | null;
  last_ok_at: Date | string | null;
  last_error: string | null;
  updated_at: Date | string | null;
}

/** The source as the api answers it: the fields the admin page shows. */
export interface XTimelineSource {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  health: string | null;
  intervalMinutes: number;
  query: string;
  searchType: string;
  lastFetchAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

/** A picture or a video of a post. */
export interface XTimelineMedia {
  kind: string;
  url: string;
  width: number | null;
  height: number | null;
  poster: string | null;
}

/** The post another post quotes. */
export interface XTimelineQuoted {
  authorName: string;
  handle: string;
  text: string;
  url: string;
  media: XTimelineMedia[];
}

/** One post of the account, as the api answers it. */
export interface XTimelinePost {
  id: string;
  url: string;
  tweetId: string | null;
  title: string;
  text: string;
  excerpt: string | null;
  publishedAt: string | null;
  lang: string | null;
  authorName: string;
  handle: string;
  avatarUrl: string | null;
  media: XTimelineMedia[];
  quoted: XTimelineQuoted | null;
  replyTo: string | null;
  heat: {
    favorite: number | null;
    retweet: number | null;
    views: number | null;
  };
}

/** The whole answer of GET /api/x-timeline. */
export interface XTimelineState {
  /** Whether a username is written down at all. */
  configured: boolean;
  handle: string;
  mode: XTimelineMode;
  /** Whether the paid api key is there: a yes or a no, never the key itself. */
  hasKey: boolean;
  source: XTimelineSource | null;
  posts: XTimelinePost[];
}
