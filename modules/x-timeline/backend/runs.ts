// What every collection of the timeline did: what was found, what was new, what was left out and
// what went wrong. Written after each run, so the page can say what happened without waiting for
// the next one, and so the gap between two runs can be kept.
import { sql } from "@aihot/backend/db";
import { iso } from "./state.ts";
import type { XTimelineCollection } from "./types.ts";

/** One run of the collector, as it is written down. */
export interface CollectionRun {
  mode: string;
  sourceId: string;
  status: number;
  found: number;
  created: number;
  skipped: number;
  error: string | null;
}

/** Writes down how a run went. A table that is not there yet is no reason to fail the run for. */
export async function recordCollection(run: CollectionRun): Promise<void> {
  try {
    await sql`
      INSERT INTO x_timeline_runs (mode, source_id, status, found, created, skipped, error)
      VALUES (${run.mode}, ${run.sourceId}, ${run.status}, ${run.found}, ${run.created}, ${run.skipped}, ${run.error})`;
  } catch {
    // The migrations have not run: the page shows no last run, the collection itself is unaffected.
  }
}

/** The last run, as the api answers it. */
export async function lastCollection(): Promise<XTimelineCollection | null> {
  try {
    const rows = await sql<
      { status: number; found: number; created: number; skipped: number; error: string | null; at: Date }[]
    >`
      SELECT status, found, created, skipped, error, at
      FROM x_timeline_runs ORDER BY at DESC, id DESC LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    return {
      status: Number(row.status ?? 0),
      found: Number(row.found ?? 0),
      created: Number(row.created ?? 0),
      skipped: Number(row.skipped ?? 0),
      error: row.error ?? null,
      at: iso(row.at),
    };
  } catch {
    return null;
  }
}

/** When the last run happened, so the next one can wait for the gap the configuration asks for. */
export async function lastCollectionAt(): Promise<Date | null> {
  try {
    const rows = await sql<{ at: Date }[]>`SELECT at FROM x_timeline_runs ORDER BY at DESC, id DESC LIMIT 1`;
    const at = rows[0]?.at;
    return at ? new Date(at) : null;
  } catch {
    return null;
  }
}

/** How many minutes ago the last run happened, or null when there was none. */
export async function minutesSinceLastCollection(): Promise<number | null> {
  const at = await lastCollectionAt();
  if (!at) return null;
  return Math.max(0, Math.round((Date.now() - at.getTime()) / 60000));
}
