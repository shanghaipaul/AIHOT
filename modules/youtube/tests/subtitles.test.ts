// 字幕归档的测试：文件落在哪儿、文件名怎么消毒、过期怎么判、合订本长什么样。
// 这些都不连数据库：文件路径和纯文本的判断最容易悄悄变坏，落错目录就等于没归档。
import test from "node:test";
import assert from "node:assert/strict";
import {
  isSubtitleExpired,
  safeFilePart,
  subtitleContent,
  subtitleCutoff,
  subtitleFilePath,
  subtitleText,
  subtitleTextFilePath,
} from "../backend/transcript.ts";
import { formatDuration, renderArchiveMarkdown, renderArchiveText, type SubtitleArchiveEntry } from "../backend/api.ts";

const DATA_DIR = "/tmp/aihot-youtube-test";

test("字幕文件落在 dataDir/youtube/subtitles 下，扩展名分 vtt 和 txt", () => {
  assert.equal(subtitleFilePath("abc123", "zh-Hans", DATA_DIR), DATA_DIR + "/youtube/subtitles/abc123.zh-Hans.vtt");
  assert.equal(subtitleFilePath("abc123", "zh-Hans", DATA_DIR, "txt"), DATA_DIR + "/youtube/subtitles/abc123.zh-Hans.txt");
  assert.equal(subtitleTextFilePath("abc123", "en", DATA_DIR), DATA_DIR + "/youtube/subtitles/abc123.en.txt");
});

test("文件名里的非法字符被换掉，不写到目录外面去", () => {
  assert.equal(safeFilePart("../../etc/passwd"), "_.._etc_passwd");
  assert.equal(safeFilePart("a:b*c?d"), "a_b_c_d");
  assert.equal(safeFilePart("   "), "unknown");
  assert.equal(safeFilePart(""), "unknown");
  assert.equal(safeFilePart(".."), "unknown");
  assert.equal(safeFilePart("x".repeat(200)).length, 64);
  assert.equal(subtitleFilePath("../../evil", "zh", DATA_DIR).startsWith(DATA_DIR + "/youtube/subtitles/"), true);
});

test("空字幕不归档，有内容才留", () => {
  assert.equal(subtitleContent("   \n "), null);
  assert.equal(subtitleContent("WEBVTT\n"), "WEBVTT");
  assert.equal(subtitleText("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n"), null);
  assert.equal(subtitleText("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n你好"), "你好");
});

test("过期判断：太老的算过期，读不出时间的当没过期", () => {
  const now = new Date("2026-11-11T00:00:00Z");
  assert.equal(subtitleCutoff(90, now).toISOString(), "2026-08-13T00:00:00.000Z");
  assert.equal(isSubtitleExpired("2026-01-01T00:00:00Z", 90, now), true);
  assert.equal(isSubtitleExpired("2026-11-01T00:00:00Z", 90, now), false);
  assert.equal(isSubtitleExpired("不是时间", 90, now), false);
});

test("时长换算成 mm:ss", () => {
  assert.equal(formatDuration(734), "12:14");
  assert.equal(formatDuration(3723), "1:02:03");
  assert.equal(formatDuration(null), "");
  assert.equal(formatDuration(0), "");
});

const ENTRY: SubtitleArchiveEntry = {
  videoId: "abc123",
  language: "zh-Hans",
  provider: "yt.chocolatemoo53.com",
  fetchedAt: "2026-11-11T00:00:00.000Z",
  content: "WEBVTT\n",
  contentText: "这是一段字幕正文",
  title: "测试标题",
  url: "https://www.youtube.com/watch?v=abc123",
  channelTitle: "AI学长小林",
  channelHandle: "@linbintalk",
  durationSeconds: 734,
  publishedAt: "2026-11-10T13:13:50.000Z",
};

test("合订本里有目录、标题、频道、时长和链接，正文是纯文本", () => {
  const md = renderArchiveMarkdown([ENTRY], "2026-11-11");
  assert.equal(md.includes("## 目录"), true);
  assert.equal(md.includes("【标题】测试标题"), true);
  assert.equal(md.includes("【频道】@linbintalk（AI学长小林）"), true);
  assert.equal(md.includes("【时长】12:14"), true);
  assert.equal(md.includes("https://www.youtube.com/watch?v=abc123"), true);
  assert.equal(md.includes("这是一段字幕正文"), true);
  assert.equal(md.includes("WEBVTT"), false);
});

test("纯文本合订本不带 Markdown 标记", () => {
  const txt = renderArchiveText([ENTRY]);
  assert.equal(txt.includes("【标题】测试标题"), true);
  assert.equal(txt.includes("这是一段字幕正文"), true);
  assert.equal(txt.includes("## 目录"), false);
  assert.equal(txt.includes("["), false);
});
