// 字幕精华提炼的测试：jsonb 怎么整理成接口数据、统计怎么算、纯文本合订本长什么样。
// 不连数据库：拼装和渲染最容易悄悄变坏（字段名对不上、undefined 漏到页面上）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  asDataPoints,
  asEntities,
  asStringList,
  digestStats,
  digestUrl,
  mergeVideoFields,
  renderDigestsText,
  toDigestItem,
  toIso,
} from "../backend/digestApi.ts";
import type { DigestRow } from "../backend/digest.ts";

function row(overrides: Partial<DigestRow> = {}): DigestRow {
  return {
    video_id: "u3K9DjeCBj4",
    channel_id: "UCBj9S8TBRlCU4QnhTEOdWZQ",
    channel_title: "Back to Axton",
    title: "DeepSeek Super Agent",
    duration_seconds: 734,
    published_at: new Date("2026-11-10T13:13:50Z"),
    one_liner: "两美元做出一个能玩的 3D 射击游戏。",
    summary_zh: "这期实测了 DeepSeek 的 Super Agent 从零写出一款 3D 射击游戏。",
    key_points: ["用 2 美元租了一台机器", "跑通了 3D 射击游戏"],
    data_points: [{ label: "成本", value: "2 美元", note: "整台机器的租用价" }],
    entities: [{ name: "DeepSeek", note: "这次的 Agent" }],
    audience: "想看 Agent 能做到什么的人",
    caveats: ["游戏画面还比较粗糙"],
    model: "default",
    prompt_version: "youtube-digest-zh@v1",
    status: "done",
    last_error: null,
    updated_at: new Date("2026-11-11T06:00:00Z"),
    ...overrides,
  };
}

test("jsonb 里的数组统一收成字符串数组", () => {
  assert.deepEqual(asStringList(["a", " b ", "", null]), ["a", "b"]);
  assert.deepEqual(asStringList("不是数组"), []);
  assert.deepEqual(asStringList(null), []);
});

test("关键数据和名词表缺字段时补成空串", () => {
  assert.deepEqual(asDataPoints([{ label: "成本", value: "2 美元" }]), [{ label: "成本", value: "2 美元", note: "" }]);
  assert.deepEqual(asDataPoints(null), []);
  assert.deepEqual(asEntities([{ name: "DeepSeek" }]), [{ name: "DeepSeek", note: "" }]);
  assert.deepEqual(asEntities(undefined), []);
});

test("一行记录变成接口数据，字段名一一对得上", () => {
  const item = toDigestItem(row());
  assert.equal(item.videoId, "u3K9DjeCBj4");
  assert.equal(item.channelId, "UCBj9S8TBRlCU4QnhTEOdWZQ");
  assert.equal(item.channelTitle, "Back to Axton");
  assert.equal(item.title, "DeepSeek Super Agent");
  assert.equal(item.url, "https://www.youtube.com/watch?v=u3K9DjeCBj4");
  assert.equal(item.durationSeconds, 734);
  assert.equal(item.publishedAt, "2026-11-10T13:13:50.000Z");
  assert.equal(item.updatedAt, "2026-11-11T06:00:00.000Z");
  assert.equal(item.oneLiner, "两美元做出一个能玩的 3D 射击游戏。");
  assert.equal(item.summary, "这期实测了 DeepSeek 的 Super Agent 从零写出一款 3D 射击游戏。");
  assert.deepEqual(item.keyPoints, ["用 2 美元租了一台机器", "跑通了 3D 射击游戏"]);
  assert.deepEqual(item.dataPoints, [{ label: "成本", value: "2 美元", note: "整台机器的租用价" }]);
  assert.deepEqual(item.entities, [{ name: "DeepSeek", note: "这次的 Agent" }]);
  assert.equal(item.audience, "想看 Agent 能做到什么的人");
  assert.deepEqual(item.caveats, ["游戏画面还比较粗糙"]);
  assert.equal(item.model, "default");
});

test("标题缺失时用视频 id 顶上，缺的时间给 null", () => {
  const item = toDigestItem(row({ title: null, published_at: null, updated_at: null }));
  assert.equal(item.title, "u3K9DjeCBj4");
  assert.equal(item.publishedAt, null);
  assert.equal(item.updatedAt, null);
  assert.equal(toIso("不是时间"), null);
  assert.equal(toIso(null), null);
});

test("统计里待提炼的数量不会算成负数", () => {
  assert.deepEqual(digestStats(10, 4, 1), { total: 10, done: 4, blocked: 1, pending: 5 });
  assert.deepEqual(digestStats(2, 3, 0), { total: 2, done: 3, blocked: 0, pending: 0 });
  assert.deepEqual(digestStats(0, 0, 0), { total: 0, done: 0, blocked: 0, pending: 0 });
});

test("链接统一拼成 youtube 观看地址", () => {
  assert.equal(digestUrl("abc123"), "https://www.youtube.com/watch?v=abc123");
});

test("纯文本合订本里有结论、要点、数据、名词、适合谁和注意事项", () => {
  const text = renderDigestsText([row()]);
  assert.match(text, /DeepSeek Super Agent/);
  assert.match(text, /结论：两美元做出一个能玩的 3D 射击游戏。/);
  assert.match(text, /要点：/);
  assert.match(text, /关键数据：/);
  assert.match(text, /名词：/);
  assert.match(text, /适合谁：/);
  assert.match(text, /注意事项：/);
  assert.equal(text.includes("**"), false);
});

test("空的字段不占地方", () => {
  const text = renderDigestsText([row({ one_liner: "", summary_zh: "", key_points: [], data_points: [], entities: [], audience: "", caveats: [] })]);
  assert.equal(text.includes("结论："), false);
  assert.equal(text.includes("适合谁："), false);
  assert.match(text, /DeepSeek Super Agent/);
});

test("提炼表里缺的标题和频道从视频表补上", () => {
  const merged = mergeVideoFields(
    [row({ title: null, channel_id: null, channel_title: null })],
    [{ video_id: "u3K9DjeCBj4", title: "DeepSeek Super Agent", channel_id: "UC1", channel_title: "Back to Axton" }],
  );
  assert.equal(merged[0].title, "DeepSeek Super Agent");
  assert.equal(merged[0].channel_id, "UC1");
  assert.equal(merged[0].channel_title, "Back to Axton");
});

test("提炼表里已经有的标题和频道不被视频表覆盖", () => {
  const merged = mergeVideoFields(
    [row({ title: "库里写的标题", channel_title: "库里的频道" })],
    [{ video_id: "u3K9DjeCBj4", title: "视频表的标题", channel_id: "UC1", channel_title: "视频表的频道" }],
  );
  assert.equal(merged[0].title, "库里写的标题");
  assert.equal(merged[0].channel_title, "库里的频道");
});
