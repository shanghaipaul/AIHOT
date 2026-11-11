// 纯函数的测试：字幕清洗、时长换算、页面里的 JSON 提取。
// 这些地方最容易悄悄变坏（标签没删干净、中文被拆开、JSON 截断），所以单独钉住。
import test from "node:test";
import assert from "node:assert/strict";
import { durationToSeconds, extractInitialJson, limitFromEnv, parseChannelPage } from "../backend/fetch.ts";
import { parseVtt, windowDays } from "../backend/transcript.ts";
import { clampLists, statusForError } from "../backend/analyze.ts";

const VTT = [
  "WEBVTT",
  "Kind: captions",
  "Language: zh-Hans",
  "",
  "00:00:00.000 --> 00:00:02.520 align:start position:0%",
  "<c.colorFFFFFF>大家好</c>，欢迎来到本期节目",
  "",
  "00:00:02.520 --> 00:00:05.000",
  "今天我们聊聊 &amp; 一些 <b>AI</b> 话题",
  "",
].join("\n");

test("parseVtt 去掉时间戳、序号、标签和实体，中文留着", () => {
  const text = parseVtt(VTT);
  assert.equal(text, "大家好，欢迎来到本期节目今天我们聊聊 & 一些 AI 话题");
  assert.equal(text.includes("-->"), false);
  assert.equal(text.includes("00:00:00.000"), false);
  assert.equal(text.includes("<c."), false);
  assert.equal(text.includes("&amp;"), false);
  assert.equal(text.includes("WEBVTT"), false);
  assert.equal(text.includes("Kind: captions"), false);
});

test("parseVtt 里的 NOTE 注释不算字幕", () => {
  const vtt = ["WEBVTT", "", "NOTE 这段是注释", "00:00:00.000 --> 00:00:01.000", "", "00:00:01.000 --> 00:00:02.000", "真正的字幕"].join("\n");
  assert.equal(parseVtt(vtt), "真正的字幕");
});

test("parseVtt 英文之间留空格", () => {
  const vtt = ["WEBVTT", "", "00:00:00.000 --> 00:00:01.000", "hello", "", "00:00:01.000 --> 00:00:02.000", "world"].join("\n");
  assert.equal(parseVtt(vtt), "hello world");
});

test("parseVtt 空输入给出空文本", () => {
  assert.equal(parseVtt(""), "");
  assert.equal(parseVtt("WEBVTT"), "");
});

test("时长换算", () => {
  assert.equal(durationToSeconds("12:14"), 734);
  assert.equal(durationToSeconds("1:02:03"), 3723);
  assert.equal(durationToSeconds("59"), null);
  assert.equal(durationToSeconds("abc"), null);
  assert.equal(durationToSeconds(null), null);
});

test("页面里的 JSON 里有大括号也不会被截断", () => {
  const html = "var ytInitialData = " + JSON.stringify({ a: "}{", b: { c: [1, 2] } }) + "; var next = 1;";
  assert.deepEqual(extractInitialJson(html, "ytInitialData = "), { a: "}{", b: { c: [1, 2] } });
  assert.equal(extractInitialJson("没有这段标记", "ytInitialData = "), null);
});

test("频道页读出 Videos 标签页里的视频", () => {
  const lockup = {
    contentId: "abc123",
    metadata: { lockupMetadataViewModel: { title: { content: "测试标题" } } },
    contentImage: {
      thumbnailViewModel: {
        overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: "12:14" } }] } }],
        image: { sources: [{ url: "https://i.ytimg.com/vi/abc123/hq.jpg" }] },
      },
    },
  };
  const data = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          { tabRenderer: { title: "Home", content: { richGridRenderer: { contents: [] } } } },
          { tabRenderer: { title: "Videos", content: { richGridRenderer: { contents: [{ richItemRenderer: { content: { lockupViewModel: lockup } } }] } } } },
        ],
      },
    },
  };
  const html = "<html>var ytInitialData = " + JSON.stringify(data) + ";</html>";
  const videos = parseChannelPage(html);
  assert.equal(videos.length, 1);
  assert.equal(videos[0]!.videoId, "abc123");
  assert.equal(videos[0]!.title, "测试标题");
  assert.equal(videos[0]!.durationSeconds, 734);
  assert.equal(videos[0]!.thumbnail, "https://i.ytimg.com/vi/abc123/hq.jpg");
});

test("limitFromEnv 读环境变量，非法值回落默认", () => {
  const key = "YOUTUBE_TEST_LIMIT";
  delete process.env[key];
  assert.equal(limitFromEnv(key, 5), 5);
  process.env[key] = "12";
  assert.equal(limitFromEnv(key, 5), 12);
  process.env[key] = "abc";
  assert.equal(limitFromEnv(key, 5), 5);
  process.env[key] = "0";
  assert.equal(limitFromEnv(key, 5), 5);
  process.env[key] = "-3";
  assert.equal(limitFromEnv(key, 5), 5);
  process.env[key] = "7";
  assert.equal(limitFromEnv(key), 7);
  delete process.env[key];
});

test("字幕补齐的时间窗口可以配置，非法值回落 7 天", () => {
  const key = "YOUTUBE_TRANSCRIPT_WINDOW_DAYS";
  delete process.env[key];
  assert.equal(windowDays(), 7);
  process.env[key] = "90";
  assert.equal(windowDays(), 90);
  process.env[key] = "abc";
  assert.equal(windowDays(), 7);
  process.env[key] = "0";
  assert.equal(windowDays(), 7);
  delete process.env[key];
});

test("模型多给的要点和标签会截断到 5 条", () => {
  const clamped = clampLists({
    summary_zh: "这期讲的是本地部署模型的实测过程和踩过的坑。",
    key_points: ["一", "二", "三", "四", "五", "六", "七"],
    topics: ["甲", "乙", "丙", "丁", "戊", "己"],
  });
  assert.equal(clamped.key_points.length, 5);
  assert.deepEqual(clamped.key_points, ["一", "二", "三", "四", "五"]);
  assert.equal(clamped.topics.length, 5);
  assert.deepEqual(clamped.topics, ["甲", "乙", "丙", "丁", "戊"]);
});

test("422 是内容侧拒收，其它错误算临时故障", () => {
  assert.equal(statusForError({ status: 422 }), "blocked");
  assert.equal(statusForError({ status: 500 }), "failed");
  assert.equal(statusForError(new Error("连接超时")), "failed");
  assert.equal(statusForError(null), "failed");
});
