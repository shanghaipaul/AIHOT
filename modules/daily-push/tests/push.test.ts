// The push reads a daily through the public read layer and writes it to a file. The test seeds one
// daily in the database it runs on, and checks the Markdown, the file and the second push skipping.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { addDays, beijingDate } from "@aihot/contracts/time";
import { pushDaily, pushLatestDaily, renderDaily } from "../backend/push.ts";

const DATE = "2026-10-28";

after(async () => { await closeDb(); });

test("a daily is pushed as Markdown, and only once", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "daily-push-"));
  const before = process.env.AIHOT_DATA_DIR;
  process.env.AIHOT_DATA_DIR = dir;
  try {
    await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
      VALUES (${"daily"}, ${DATE}, now(), now(), ${sql.json({
        sections: [{ label: "模型", items: [{ title: "推送测试条目", summary: "这是摘要", source: { name: "测试来源" }, links: { original: "https://example.com/a" } }] }],
        flashes: [],
      })}, now())`;

    const markdown = await renderDaily(DATE);
    assert.ok(markdown, "这一期日报应该读得到");
    assert.match(markdown, /推送测试条目/);
    assert.match(markdown, /测试来源/);

    const pushed = await pushDaily(DATE);
    assert.equal(pushed.status, "pushed");
    assert.ok(pushed.file);
    const written = await readFile(pushed.file, "utf8");
    assert.match(written, /推送测试条目/);

    const again = await pushDaily(DATE);
    assert.equal(again.status, "skipped");
  } finally {
    await sql`DELETE FROM reports WHERE kind = ${"daily"} AND key = ${DATE}`;
    if (before === undefined) delete process.env.AIHOT_DATA_DIR;
    else process.env.AIHOT_DATA_DIR = before;
    await rm(dir, { recursive: true, force: true });
  }
});

test("a daily that is not out yet is not pushed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "daily-push-"));
  const before = process.env.AIHOT_DATA_DIR;
  process.env.AIHOT_DATA_DIR = dir;
  const ahead = addDays(beijingDate(new Date()), 2);
  try {
    await sql`INSERT INTO reports (kind, key, window_start, window_end, content, generated_at)
      VALUES (${"daily"}, ${ahead}, now(), now(), ${sql.json({ sections: [], flashes: [] })}, now())`;

    const result = await pushLatestDaily();
    assert.equal(result.status, "skipped");
    assert.match(result.reason ?? "", /还没到出刊时间/);
  } finally {
    await sql`DELETE FROM reports WHERE kind = ${"daily"} AND key = ${ahead}`;
    if (before === undefined) delete process.env.AIHOT_DATA_DIR;
    else process.env.AIHOT_DATA_DIR = before;
    await rm(dir, { recursive: true, force: true });
  }
});