// The collection source of the account: the row in sources that the collector reads. The module owns
// the source's life: find it, create it, keep it in step with the configuration, pause it, resume it.
// Two rows are possible, because a row has one kind of collector and the module has two ways to read
// the account: the engine's x_search collector (paid api, login cookie) and the embedded timeline the
// module reads itself (free, through a proxy).
import { sql } from "@aihot/backend/db";
import { createSource, updateSource } from "@aihot/backend/admin/sources";
import { buildXQuery, handleKey, normalizeHandle } from "./handle.ts";
import { iso } from "./state.ts";
import type { XSourceRow, XTimelineMode } from "./types.ts";

export { buildXQuery, handleFromQuery, handleKey, normalizeHandle } from "./handle.ts";

/** A failure the module explains in Chinese, so the route shows it as it is. */
export class XTimelineError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** The source the engine's x_search collector reads: the paid api and the login cookie. */
export const X_TIMELINE_SOURCE_ID = "x-timeline";

/** The source the module reads itself: the embedded timeline of the syndication mode. */
export const X_TIMELINE_EMBED_SOURCE_ID = "x-timeline-embed";

/** Who the module acts as in the audit trail. */
export const X_TIMELINE_ACTOR = "system:x-timeline";

/** How the source should be collected. */
export interface EnsureOptions {
  mode: XTimelineMode;
  includeReplies: boolean;
  intervalMinutes: number;
}

/** A row of sources, as far as this module reads it. */
export async function findSourceById(id: string): Promise<XSourceRow | null> {
  try {
    const rows = await sql<XSourceRow[]>`
      SELECT id, name, kind, config, tier, participation_mode, interval_minutes, enabled, health,
             last_fetch_at, last_ok_at, last_error, updated_at
      FROM sources WHERE id = ${id} LIMIT 1`;
    return rows[0] ?? null;
  } catch {
    // The table is not there yet (the migrations have not run): there is no source.
    return null;
  }
}

/** The x_search source that reads the account, whichever name it was created under. */
export async function findXSource(handle: string): Promise<XSourceRow | null> {
  const key = handleKey(handle);
  if (!key) return null;
  try {
    const rows = await sql<XSourceRow[]>`
      SELECT id, name, kind, config, tier, participation_mode, interval_minutes, enabled, health,
             last_fetch_at, last_ok_at, last_error, updated_at
      FROM sources
      WHERE kind = 'x_search'
        AND lower((regexp_match(coalesce(config->>'query', ''), 'from:([A-Za-z0-9_]{1,15})', 'i'))[1]) = ${key}
      LIMIT 1`;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** The source of the account, created or updated so that it reads what the configuration says. */
export async function ensureXSource(handle: string, options: EnsureOptions): Promise<XSourceRow> {
  if (options.mode === "syndication") return await ensureEmbedSource(handle, options);
  const name = normalizeHandle(handle);
  const query = buildXQuery(name, options.includeReplies);
  const interval = Math.max(1, Math.min(1440, Math.trunc(options.intervalMinutes) || 120));
  const existing = (await findXSource(name)) ?? (await findSourceById(X_TIMELINE_SOURCE_ID));
  if (existing) {
    const config = (existing.config ?? {}) as Record<string, unknown>;
    const currentQuery = typeof config.query === "string" ? config.query : "";
    const currentSearch = typeof config.searchType === "string" ? config.searchType : "";
    const same =
      currentQuery === query &&
      currentSearch === "Latest" &&
      existing.interval_minutes === interval &&
      existing.tier === "EXCLUDE_MP" &&
      existing.participation_mode === "isolated";
    if (same) return existing;
    const updated = await updateSource(
      existing.id,
      {
        patch: {
          name: "X @" + name,
          config: { ...config, query, searchType: "Latest" },
          interval_minutes: interval,
          tier: "EXCLUDE_MP",
          participation_mode: "isolated",
        },
        version: iso(existing.updated_at) ?? new Date().toISOString(),
        reason: "同步 X 时间线的采集配置",
      },
      X_TIMELINE_ACTOR,
    );
    return (updated as unknown as XSourceRow) ?? existing;
  }
  const created = await createSource(
    {
      id: X_TIMELINE_SOURCE_ID,
      name: "X @" + name,
      kind: "x_search",
      config: { query, searchType: "Latest" },
      tier: "EXCLUDE_MP",
      participation_mode: "isolated",
      interval_minutes: interval,
      tags: ["X"],
      site_fulltext: false,
      syndicate_fulltext: false,
    },
    X_TIMELINE_ACTOR,
  );
  if (created.created) return created.source as unknown as XSourceRow;
  const duplicate = await findSourceById(created.duplicate.id);
  if (duplicate) return duplicate;
  throw new XTimelineError("采集源创建失败：" + created.duplicate.name);
}

/**
 * The source of the embedded timeline: a row of its own, because a row has one collector and the
 * engine does not read the embedded timeline. The module writes into it and keeps it in step.
 */
export async function ensureEmbedSource(handle: string, options: EnsureOptions): Promise<XSourceRow> {
  const name = normalizeHandle(handle);
  const interval = Math.max(1, Math.min(1440, Math.trunc(options.intervalMinutes) || 120));
  const existing = await findSourceById(X_TIMELINE_EMBED_SOURCE_ID);
  if (existing) {
    const same =
      existing.interval_minutes === interval &&
      existing.tier === "EXCLUDE_MP" &&
      existing.participation_mode === "isolated" &&
      existing.name === "X @" + name + "（嵌入时间线）";
    if (same) return existing;
    const updated = await updateSource(
      existing.id,
      {
        patch: {
          name: "X @" + name + "（嵌入时间线）",
          interval_minutes: interval,
          tier: "EXCLUDE_MP",
          participation_mode: "isolated",
        },
        version: iso(existing.updated_at) ?? new Date().toISOString(),
        reason: "同步 X 时间线的采集配置",
      },
      X_TIMELINE_ACTOR,
    );
    return (updated as unknown as XSourceRow) ?? existing;
  }
  const created = await createSource(
    {
      id: X_TIMELINE_EMBED_SOURCE_ID,
      name: "X @" + name + "（嵌入时间线）",
      kind: "external",
      config: {},
      tier: "EXCLUDE_MP",
      participation_mode: "isolated",
      interval_minutes: interval,
      tags: ["X", "自采"],
      site_fulltext: false,
      syndicate_fulltext: false,
    },
    X_TIMELINE_ACTOR,
  );
  if (created.created) return created.source as unknown as XSourceRow;
  const duplicate = await findSourceById(created.duplicate.id);
  if (duplicate) return duplicate;
  throw new XTimelineError("采集源创建失败：" + created.duplicate.name);
}

/** Pauses or resumes a source, with the reason written into the audit trail. */
export async function setSourceEnabled(id: string, enabled: boolean, actor: string): Promise<XSourceRow | null> {
  const row = await findSourceById(id);
  if (!row) return null;
  const updated = await updateSource(
    id,
    {
      patch: { enabled },
      version: iso(row.updated_at) ?? new Date().toISOString(),
      reason: enabled ? "恢复 X 时间线采集源" : "暂停 X 时间线采集源",
    },
    actor,
  );
  return (updated as unknown as XSourceRow) ?? null;
}
