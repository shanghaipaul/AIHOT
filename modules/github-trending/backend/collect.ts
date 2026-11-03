// Reading the trending list from GitHub and keeping it: the worker's schedule calls it, and the api's
// refresh route calls it for one period. GitHub's own list is short (a dozen repositories or so), so the
// list is read per language as well and the lists are merged: what a period keeps is then the hundred
// repositories that gained the most stars.
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { parseTrending } from "./parse.ts";
import { TRENDING_PERIODS, type TrendingPeriod, type TrendingRepo } from "./types.ts";

/** The languages whose lists are read too; the global list alone holds a dozen repositories. */
const DEFAULT_LANGUAGES = [
  "python", "javascript", "typescript", "go", "rust", "java", "c++", "c", "c#", "php",
  "ruby", "swift", "kotlin", "scala", "shell", "vue", "dart", "elixir", "haskell", "lua",
];

/** The languages to read: the list above, or what the deployment writes down. */
function languages(): string[] {
  const raw = process.env.GITHUB_TRENDING_LANGUAGES?.trim();
  if (!raw) return DEFAULT_LANGUAGES;
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

/** How many repositories a period keeps. */
function limit(): number {
  const value = Number(process.env.GITHUB_TRENDING_LIMIT ?? 100);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 100;
}

/** Between two requests, so GitHub sees one reader and not a burst. */
const PAUSE_MS = 250;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The page is a few hundred kilobytes; the default body limit is far smaller. */
const MAX_BYTES = 2_000_000;

/** One list from GitHub; an empty list when that page cannot be read. */
async function fetchList(url: string): Promise<TrendingRepo[]> {
  const response = await guardedFetch(url, {
    headers: { accept: "text/html" },
    timeoutMs: 30_000,
    maxBytes: MAX_BYTES,
    truncate: true,
  });
  if (response.status !== 200) return [];
  return parseTrending(response.text());
}

/** The repository that gained the most stars comes first. */
function byGain(a: TrendingRepo, b: TrendingRepo): number {
  const gainA = a.starsPeriod ?? -1;
  const gainB = b.starsPeriod ?? -1;
  if (gainA !== gainB) return gainB - gainA;
  return (b.stars ?? 0) - (a.stars ?? 0);
}

/**
 * Reads the list for one period and writes it, replacing what that period held. The global list and
 * the list of every language are read; a list that cannot be read does not stop the others, and a
 * repository that is in two lists is kept once, with the larger gain.
 */
export async function collectTrending(period: TrendingPeriod): Promise<TrendingRepo[]> {
  const since = period === "daily" ? "daily" : period === "weekly" ? "weekly" : "monthly";
  const urls = [
    `https://github.com/trending?since=${since}`,
    ...languages().map((lang) => `https://github.com/trending/${encodeURIComponent(lang)}?since=${since}`),
  ];
  const repos = new Map<string, TrendingRepo>();
  let read = 0;
  for (const url of urls) {
    let list: TrendingRepo[] = [];
    try {
      list = await fetchList(url);
    } catch {
      list = [];
    }
    if (list.length > 0) read += 1;
    for (const repo of list) {
      const seen = repos.get(repo.repo);
      if (!seen || (repo.starsPeriod ?? -1) > (seen.starsPeriod ?? -1)) repos.set(repo.repo, repo);
    }
    await sleep(PAUSE_MS);
  }
  if (read === 0) throw new Error(`github trending ${period} could not be read`);
  const merged = [...repos.values()].sort(byGain).slice(0, limit()).map((repo, index) => ({ ...repo, rank: index + 1 }));
  await saveTrending(period, merged);
  return merged;
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