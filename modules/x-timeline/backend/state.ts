// The answer the api gives, built from what was read: the configuration, the source and the posts.
// Pure, so the page and the tests see the same shape.
import type {
  XSourceRow,
  XTimelineCollection,
  XTimelineMode,
  XTimelinePost,
  XTimelineSource,
  XTimelineState,
} from "./types.ts";

/** A time as an ISO string, or null when there is no time. */
export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The source, as the api answers it. */
export function sourceSummary(row: XSourceRow): XTimelineSource {
  const config = row.config ?? {};
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled,
    health: row.health ?? null,
    intervalMinutes: row.interval_minutes,
    query: typeof config.query === "string" ? config.query : "",
    searchType: typeof config.searchType === "string" ? config.searchType : "Latest",
    lastFetchAt: iso(row.last_fetch_at),
    lastOkAt: iso(row.last_ok_at),
    lastError: row.last_error ?? null,
    updatedAt: iso(row.updated_at),
  };
}

/** The whole answer: the configuration, the source and the posts (the list is never missing). */
export function buildTimelineState(input: {
  handle: string;
  mode: XTimelineMode;
  hasKey: boolean;
  /** Whether a proxy is written down: a yes or a no, never the address itself. */
  hasProxy?: boolean;
  source: XTimelineSource | null;
  posts?: XTimelinePost[];
  /** How the last collection went, when there was one. */
  lastCollection?: XTimelineCollection | null;
}): XTimelineState {
  return {
    configured: input.handle.trim() !== "",
    handle: input.handle,
    mode: input.mode,
    hasKey: input.hasKey,
    hasProxy: input.hasProxy === true,
    source: input.source,
    posts: input.posts ?? [],
    lastCollection: input.lastCollection ?? null,
  };
}
