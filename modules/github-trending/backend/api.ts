// What the page reads: the list of one period, as it was last read from GitHub.
import { sql } from "@aihot/backend/db";
import { readPeriod, type TrendingSnapshot } from "./types.ts";

interface Row {
  position: number;
  repo: string;
  owner: string;
  name: string;
  url: string;
  description: string | null;
  description_zh: string | null;
  language: string | null;
  stars: number | null;
  forks: number | null;
  stars_period: number | null;
  fetched_at: Date;
}

/** The list of a period; an empty list when it has not been read (or the table is not there yet). */
export async function loadTrending(period: unknown): Promise<TrendingSnapshot> {
  const key = readPeriod(period);
  let rows: Row[] = [];
  try {
    rows = await sql<Row[]>`
      SELECT t.position, t.repo, t.owner, t.name, t.url, t.description, t.language, t.stars, t.forks, t.stars_period, t.fetched_at,
             z.zh AS description_zh
      FROM github_trending t
      LEFT JOIN github_trending_zh z ON z.repo = t.repo AND z.description = t.description
      WHERE t.period = ${key} ORDER BY t.position`;
  } catch {
    // The table arrives with the migration; before that the page shows an empty list, not an error.
    rows = [];
  }
  return {
    period: key,
    fetchedAt: rows[0]?.fetched_at ? rows[0].fetched_at.toISOString() : null,
    repos: rows.map((row) => ({
      rank: row.position,
      repo: row.repo,
      owner: row.owner,
      name: row.name,
      url: row.url,
      description: row.description,
      descriptionZh: row.description_zh,
      language: row.language,
      stars: row.stars,
      forks: row.forks,
      starsPeriod: row.stars_period,
    })),
  };
}