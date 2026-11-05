// What the page reads: the hand-written list, plus the collected list as it was last read.
import { sql } from "@aihot/backend/db";
import { categoryZh } from "./categories.ts";
import { CURATED_FREEBIES } from "./catalogue.ts";
import type { FreebieItem, FreebiesSnapshot } from "./types.ts";

interface Row {
  category: string;
  name: string;
  url: string;
  detail: string | null;
}

interface MetaRow {
  stars: number | null;
  repo_updated_at: Date | null;
  fetched_at: Date;
}

/** The list as the page shows it; the collected part is empty before the first read. */
export async function loadFreebies(): Promise<FreebiesSnapshot> {
  let rows: Row[] = [];
  let fetchedAt: string | null = null;
  let stars: number | null = null;
  let updatedAt: string | null = null;
  try {
    rows = await sql<Row[]>`SELECT category, name, url, detail FROM freebies_dev ORDER BY position`;
  } catch {
    // The table arrives with the migration; before that the page shows the hand-written list only.
    rows = [];
  }
  try {
    const meta = await sql<MetaRow[]>`SELECT stars, repo_updated_at, fetched_at FROM freebies_source WHERE id = 1`;
    if (meta[0]) {
      stars = meta[0].stars ?? null;
      updatedAt = meta[0].repo_updated_at ? meta[0].repo_updated_at.toISOString() : null;
      fetchedAt = meta[0].fetched_at ? meta[0].fetched_at.toISOString() : null;
    }
  } catch {
    stars = null;
    updatedAt = null;
  }
  const curated: FreebieItem[] = CURATED_FREEBIES.map((entry) => ({
    category: entry.category,
    name: entry.name,
    vendor: entry.vendor,
    url: entry.url,
    quota: entry.quota,
    detail: entry.note ?? "",
    source: "curated" as const,
  }));
  const dev: FreebieItem[] = rows.map((row) => ({
    category: categoryZh(row.category),
    name: row.name,
    vendor: "",
    url: row.url,
    quota: "",
    detail: row.detail ?? "",
    source: "free-for.dev" as const,
  }));
  return {
    curated,
    dev,
    devFetchedAt: fetchedAt,
    devSource: { repo: "ripienaar/free-for-dev", stars, updatedAt },
  };
}
