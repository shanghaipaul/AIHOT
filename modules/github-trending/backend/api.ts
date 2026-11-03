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
      SELECT position, repo, owner, name, url, description, language, stars, forks, stars_period, fetched_at
      FROM github_trending WHERE period = ${key} ORDER BY position`;
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
      language: row.language,
      stars: row.stars,
      forks: row.forks,
      starsPeriod: row.stars_period,
    })),
  };
}