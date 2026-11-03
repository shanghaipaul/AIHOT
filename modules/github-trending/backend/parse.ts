// Reading GitHub's trending page: the repositories it shows for a period, as the fields the module keeps.
import { load } from "cheerio";
import type { TrendingRepo } from "./types.ts";

/** "12,345" becomes 12345; text without a digit is nothing. */
function count(text: string): number | null {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

/** The stars the repository gained in the period ("1,138 stars today"). */
function periodStars(text: string): number | null {
  const match = /([\d,]+)\s+stars?\s+(today|this week|this month)/i.exec(text);
  return match ? count(match[1]) : null;
}

/**
 * The repositories in the page's order. A row without a repository link is not one (the page's sponsor
 * block and its promotions share the row markup), so it is skipped instead of stored as an empty row.
 */
export function parseTrending(html: string): TrendingRepo[] {
  const $ = load(html);
  const repos: TrendingRepo[] = [];
  $("article.Box-row").each((_index, element) => {
    const row = $(element);
    const repo = (row.find("h2 a").first().attr("href") ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!/^[^/]+\/[^/]+$/.test(repo)) return;
    const [owner, name] = repo.split("/");
    const description = row.find("p").first().text().replace(/\s+/g, " ").trim();
    const language = row.find('[itemprop="programmingLanguage"]').first().text().trim();
    repos.push({
      rank: repos.length + 1,
      repo,
      owner,
      name,
      url: `https://github.com/${repo}`,
      description: description || null,
      language: language || null,
      stars: count(row.find('a[href$="/stargazers"]').first().text()),
      forks: count(row.find('a[href$="/forks"]').first().text()),
      starsPeriod: periodStars(row.text()),
    });
  });
  return repos;
}