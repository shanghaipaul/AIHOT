// The pure parts of the module, pinned down: how the username is written, how the query is built,
// what the six settings default to, and what the api answers. Nothing here touches the database.
import test from "node:test";
import assert from "node:assert/strict";
import { buildXQuery, handleFromQuery, handleKey, normalizeHandle } from "../backend/handle.ts";
import {
  DEFAULT_DAILY_CAP,
  DEFAULT_INTERVAL_MINUTES,
  X_TIMELINE_KEY,
  X_TIMELINE_SETTINGS,
} from "../backend/settings.ts";
import { buildTimelineState, sourceSummary } from "../backend/state.ts";
import type { XSourceRow } from "../backend/types.ts";

test("用户名去掉 @ 和空白", () => {
  assert.equal(normalizeHandle("@realxing"), "realxing");
  assert.equal(normalizeHandle("  @realxing  "), "realxing");
  assert.equal(normalizeHandle("realxing"), "realxing");
  assert.equal(normalizeHandle(""), "");
  assert.equal(normalizeHandle("   "), "");
  assert.equal(normalizeHandle(undefined), "");
});

test("比对用户名时忽略大小写，查询里保留原样", () => {
  assert.equal(handleKey("@RealXing"), "realxing");
  assert.equal(handleKey("@realxing"), handleKey("RealXing"));
  assert.equal(buildXQuery("@RealXing", false), "from:RealXing -filter:replies");
});

test("查询默认不带回复，带上回复时只有账号", () => {
  assert.equal(buildXQuery("realxing", false), "from:realxing -filter:replies");
  assert.equal(buildXQuery("realxing", true), "from:realxing");
  assert.equal(buildXQuery("", false), "");
  assert.equal(buildXQuery("@", true), "");
});

test("查询里的账号能被读回来", () => {
  assert.equal(handleFromQuery("from:realxing -filter:replies"), "realxing");
  assert.equal(handleFromQuery("from:realxing"), "realxing");
  assert.equal(handleFromQuery("no account here"), null);
  assert.equal(handleFromQuery(null), null);
});

test("六条配置的键、类型和默认值", () => {
  assert.deepEqual(
    X_TIMELINE_SETTINGS.map((entry) => entry.key),
    [
      "x.timeline.handle",
      "x.timeline.mode",
      "x.timeline.include_replies",
      "x.timeline.cookie",
      "x.timeline.interval_minutes",
      "x.timeline.daily_cap",
    ],
  );
  const byKey = new Map(X_TIMELINE_SETTINGS.map((entry) => [entry.key, entry]));
  assert.equal(byKey.get(X_TIMELINE_KEY.handle)?.type, "string");
  assert.equal(byKey.get(X_TIMELINE_KEY.handle)?.default, "");
  assert.equal(byKey.get(X_TIMELINE_KEY.mode)?.type, "enum");
  assert.equal(byKey.get(X_TIMELINE_KEY.mode)?.default, "socialdata");
  assert.deepEqual(byKey.get(X_TIMELINE_KEY.mode)?.options, ["socialdata", "cookie"]);
  assert.equal(byKey.get(X_TIMELINE_KEY.includeReplies)?.type, "bool");
  assert.equal(byKey.get(X_TIMELINE_KEY.includeReplies)?.default, false);
  assert.equal(byKey.get(X_TIMELINE_KEY.cookie)?.secret, true);
  assert.equal(byKey.get(X_TIMELINE_KEY.cookie)?.default, "");
  assert.equal(byKey.get(X_TIMELINE_KEY.intervalMinutes)?.type, "int");
  assert.equal(byKey.get(X_TIMELINE_KEY.intervalMinutes)?.default, DEFAULT_INTERVAL_MINUTES);
  assert.equal(byKey.get(X_TIMELINE_KEY.intervalMinutes)?.default, 120);
  assert.equal(byKey.get(X_TIMELINE_KEY.dailyCap)?.type, "int");
  assert.equal(byKey.get(X_TIMELINE_KEY.dailyCap)?.default, DEFAULT_DAILY_CAP);
  assert.equal(byKey.get(X_TIMELINE_KEY.dailyCap)?.default, 200);
  for (const entry of X_TIMELINE_SETTINGS) {
    assert.equal(entry.group, "X 账号");
    assert.ok(entry.label.length > 0);
  }
});

test("接口回什么形状：没有帖子时 posts 也是数组", () => {
  const state = buildTimelineState({
    handle: "",
    mode: "socialdata",
    hasKey: false,
    source: null,
    posts: [],
  });
  assert.deepEqual(Object.keys(state).sort(), ["configured", "handle", "hasKey", "mode", "posts", "source"]);
  assert.equal(state.configured, false);
  assert.ok(Array.isArray(state.posts));
  assert.equal(state.posts.length, 0);
  assert.equal(state.source, null);
  assert.equal(state.hasKey, false);
  assert.equal(state.mode, "socialdata");
});

test("填了用户名就算配置好了，posts 仍然是数组", () => {
  const state = buildTimelineState({
    handle: "realxing",
    mode: "cookie",
    hasKey: true,
    source: null,
  });
  assert.equal(state.configured, true);
  assert.deepEqual(state.posts, []);
});

test("采集源回什么形状", () => {
  const row: XSourceRow = {
    id: "x-timeline",
    name: "X @realxing",
    kind: "x_search",
    config: { query: "from:realxing -filter:replies", searchType: "Latest" },
    tier: "T2",
    participation_mode: "editorial",
    interval_minutes: 120,
    enabled: true,
    health: "ok",
    last_fetch_at: new Date("2026-11-11T06:00:00.000Z"),
    last_ok_at: null,
    last_error: null,
    updated_at: new Date("2026-11-11T06:00:00.000Z"),
  };
  const source = sourceSummary(row);
  assert.equal(source.id, "x-timeline");
  assert.equal(source.query, "from:realxing -filter:replies");
  assert.equal(source.searchType, "Latest");
  assert.equal(source.intervalMinutes, 120);
  assert.equal(source.enabled, true);
  assert.equal(source.lastFetchAt, "2026-11-11T06:00:00.000Z");
  assert.equal(source.lastOkAt, null);
});
