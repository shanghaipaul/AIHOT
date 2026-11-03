// Reading the trending list from GitHub and keeping it: the worker's schedule calls it, and the api's
// refresh route calls it for one period.
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { parseTrending } from "./parse.ts";
import { TRENDING_PERIODS, type TrendingPeriod, type TrendingRepo } from "./types.ts";

const LIST: Record<TrendingPeriod, string> = {
  daily: "https://github.com/trending?since=daily",
  weekly: "https://github.com/trending?since=weekly",
  monthly: "https://github.com/trending?since=monthly",
};

/** The page is a few hundred kilobytes; the default body limit is far smaller. */
const MAX_BYTES = 2_000_000;

/** Reads the list for one period and writes it, replacing what that period held. */
export async function collectTrending(period: TrendingPeriod): Promise<TrendingRepo[]> {
  const response = await guardedFetch(LIST[period], {
    headers: { accept: "text/html" },
    timeoutMs: 30_000,
    maxBytes: MAX_BYTES,
    truncate: true,
  });
  if (response.status !== 200) throw new Error(`github trending ${period} answered ${response.status}`);
  const repos = parseTrending(response.text());
  await saveTrending(period, repos);
  return repos;
}

/** Reads every period; one that fails stops the rest, so a list is never half written. */
export async function collectAllTrending(): Promise<{ period: TrendingPeriod; count: number }[]> {
  const results: { period: TrendingPeriod; count: number }[] = [];
  for (const period of TRENDING_PERIODS) {
    const repos = await collectTrending(period);
    results.push({ period, count: repos.length });
  }
  return results;
}

/** Writes the list: the period's rows are replaced by what was read, in one transaction. */
async function saveTrending(period: TrendingPeriod, repos: TrendingRepo[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM github_trending WHERE period = ${period}`;
    for (const repo of repos) {
      await tx`INSERT INTO github_trending (period, position, repo, owner, name, url, description, language, stars, forks, stars_period)
        VALUES (${period}, ${repo.rank}, ${repo.repo}, ${repo.owner}, ${repo.name}, ${repo.url}, ${repo.description}, ${repo.language}, ${repo.stars}, ${repo.forks}, ${repo.starsPeriod})`;
    }
  });
}