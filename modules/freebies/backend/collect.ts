// Reading the free-for.dev list and keeping it: the worker's schedule calls it, and the api's
// refresh route calls it for a reader who asks for a fresher list.
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { parseFreeForDev } from "./parse.ts";

/** The list itself: the markdown file the repository keeps. */
const README_URL = "https://raw.githubusercontent.com/ripienaar/free-for-dev/master/README.md";
/** What the repository says about itself (stars, when it last changed). */
const REPO_URL = "https://api.github.com/repos/ripienaar/free-for-dev";
/** The file is a few hundred kilobytes; the default body limit is far smaller. */
const MAX_BYTES = 2_000_000;

/**
 * Reads the list and writes it, replacing what was there before. The list is one transaction: a
 * reader never sees half of a new list and half of the old one.
 */
export async function collectFreebies(): Promise<{ count: number }> {
  const response = await guardedFetch(README_URL, {
    headers: { accept: "text/plain" },
    timeoutMs: 30_000,
    maxBytes: MAX_BYTES,
    truncate: true,
  });
  if (response.status !== 200) throw new Error("free-for.dev read failed with status " + response.status);
  const entries = parseFreeForDev(response.text());
  if (entries.length === 0) throw new Error("free-for.dev read gave no entries");
  await sql.begin(async (tx) => {
    await tx`DELETE FROM freebies_dev`;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      await tx`INSERT INTO freebies_dev (position, category, name, url, detail)
        VALUES (${index}, ${entry.category}, ${entry.name}, ${entry.url}, ${entry.detail})`;
    }
  });
  await saveSource();
  return { count: entries.length };
}

/** What the repository says about itself; its numbers are a nicety, so a failure is not an error. */
async function saveSource(): Promise<void> {
  let stars: number | null = null;
  let updatedAt: string | null = null;
  try {
    const response = await guardedFetch(REPO_URL, {
      headers: { accept: "application/json" },
      timeoutMs: 20_000,
      maxBytes: 100_000,
      truncate: true,
    });
    if (response.status === 200) {
      const body = JSON.parse(response.text()) as { stargazers_count?: number; updated_at?: string };
      stars = typeof body.stargazers_count === "number" ? body.stargazers_count : null;
      updatedAt = typeof body.updated_at === "string" ? body.updated_at : null;
    }
  } catch {
    stars = null;
    updatedAt = null;
  }
  await sql.begin(async (tx) => {
    await tx`INSERT INTO freebies_source (id, stars, repo_updated_at, fetched_at)
      VALUES (1, ${stars}, ${updatedAt}, now())
      ON CONFLICT (id) DO UPDATE SET stars = EXCLUDED.stars, repo_updated_at = EXCLUDED.repo_updated_at, fetched_at = now()`;
  });
}
