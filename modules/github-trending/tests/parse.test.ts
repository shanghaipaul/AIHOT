import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTrending } from "../backend/parse.ts";

/** One row of GitHub's trending page. */
const ROW = (repo: string, stars = "12,345", forks = "678", gain = "1,138 stars today") => [
  '<article class="Box-row">',
  `  <h2 class="h3 lh-condensed"><a href="/${repo}"><span class="text-normal">${repo.split("/")[0]} /</span>${repo.split("/")[1]}</a></h2>`,
  '  <p class="col-9 color-fg-muted my-1">a description</p>',
  '  <div class="f6 color-fg-muted mt-2">',
  '    <span itemprop="programmingLanguage">TypeScript</span>',
  `    <a href="/${repo}/stargazers" class="Link--muted">${stars}</a>`,
  `    <a href="/${repo}/forks" class="Link--muted">${forks}</a>`,
  `    <span class="float-sm-right">${gain}</span>`,
  "  </div>",
  "</article>",
].join("\n");

test("reads the repository, its numbers and its place in the list", () => {
  const repos = parseTrending(`<html><body>${ROW("owner/name")}</body></html>`);
  assert.equal(repos.length, 1);
  assert.deepEqual(repos[0], {
    rank: 1,
    repo: "owner/name",
    owner: "owner",
    name: "name",
    url: "https://github.com/owner/name",
    description: "a description",
    language: "TypeScript",
    stars: 12345,
    forks: 678,
    starsPeriod: 1138,
  });
});

test("a row without a repository link is not a repository", () => {
  const html = '<html><body><article class="Box-row"><p>an ad</p></article></body></html>';
  assert.deepEqual(parseTrending(html), []);
});

test("the page's order is the list's order", () => {
  const repos = parseTrending(`<html><body>${ROW("a/one")}${ROW("b/two")}</body></html>`);
  assert.deepEqual(repos.map((repo) => [repo.rank, repo.repo]), [
    [1, "a/one"],
    [2, "b/two"],
  ]);
});

test("the gain of the period is read in its own words", () => {
  const repos = parseTrending(`<html><body>${ROW("a/one", "12,345", "678", "2,304 stars this week")}</body></html>`);
  assert.equal(repos[0]?.starsPeriod, 2304);
});