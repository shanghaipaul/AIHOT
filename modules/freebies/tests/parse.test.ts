import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryZh } from "../backend/categories.ts";
import { CURATED_FREEBIES } from "../backend/catalogue.ts";
import { parseFreeForDev } from "../backend/parse.ts";

test("a service under a heading becomes an entry", () => {
  const entries = parseFreeForDev(
    ["## Generative AI", "  * [Workers](https://developers.cloudflare.com/workers/) - Deploy serverless code for free"].join("\n"),
  );
  assert.deepEqual(entries, [
    {
      category: "Generative AI",
      name: "Workers",
      url: "https://developers.cloudflare.com/workers/",
      detail: "Deploy serverless code for free",
    },
  ]);
});

test("the table of contents at the top is not a service", () => {
  const entries = parseFreeForDev(
    ["# Free for developers", "  * [Generative AI](#generative-ai)"].join("\n"),
  );
  assert.deepEqual(entries, []);
});

test("a service before any heading is not a service", () => {
  const entries = parseFreeForDev(["  * [Workers](https://example.com) - free"].join("\n"));
  assert.deepEqual(entries, []);
});

test("the lines under a service belong to it", () => {
  const entries = parseFreeForDev(
    [
      "## Monitoring",
      "  * [Grafana Cloud](https://grafana.com/pricing/) - Free tier",
      "    * 5GB logs per month",
      "    * 1 user",
    ].join("\n"),
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].detail, "Free tier；5GB logs per month；1 user");
});

test("a heading ends the category of the service above it", () => {
  const entries = parseFreeForDev(
    ["## Search", "  * [Brave](https://brave.com) - 2000 queries", "## Testing", "  * [k6](https://k6.io) - open source"].join("\n"),
  );
  assert.deepEqual(
    entries.map((entry) => [entry.category, entry.name]),
    [
      ["Search", "Brave"],
      ["Testing", "k6"],
    ],
  );
});

test("a known heading gets a Chinese name and an unknown one keeps its own", () => {
  assert.equal(categoryZh("Generative AI"), "生成式 AI");
  assert.equal(categoryZh("Something New"), "Something New");
});

test("every hand-written entry has a name, a vendor, a category and a link", () => {
  assert.ok(CURATED_FREEBIES.length > 20);
  for (const entry of CURATED_FREEBIES) {
    assert.ok(entry.name.length > 0, "name");
    assert.ok(entry.vendor.length > 0, "vendor");
    assert.ok(entry.category.length > 0, "category");
    assert.ok(entry.quota.length > 0, "quota");
    assert.ok(entry.url.startsWith("https://"), entry.url);
  }
});

test("the hand-written list has no entry twice", () => {
  const names = new Set<string>();
  for (const entry of CURATED_FREEBIES) {
    assert.ok(!names.has(entry.name), entry.name);
    names.add(entry.name);
  }
});

test("markdown in the description becomes plain text", () => {
  const entries = parseFreeForDev(
    [
      "## Major Cloud Providers",
      "  * [Amazon Web Services](https://aws.amazon.com) - [CloudFront](https://aws.amazon.com/cloudfront/) - 1TB egress",
      "    * **Free tier** with `1GB` storage",
    ].join("\n"),
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].detail, "CloudFront - 1TB egress；Free tier with 1GB storage");
});
