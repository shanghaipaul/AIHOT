// The reader of the embedded timeline, pinned down: what it takes out of the page, what it does
// with a field the page leaves out, and what the collector says when there is no proxy to read
// through. Nothing here touches the network.
import test from "node:test";
import assert from "node:assert/strict";
import { parseSyndicationProfile, syndicationUrl } from "../backend/syndication.ts";
import { collectSyndication } from "../backend/collect.ts";

/** The quote character, so the page carries the same marks the endpoint writes. */
const QUOTE = String.fromCharCode(34);

/** One account with one post, as the endpoint states it. */
const DATA = {
  props: {
    pageProps: {
      headerProps: { screenName: "ShanghaiPaul", name: "上海 Paul" },
      timeline: {
        entries: [
          {
            content: {
              tweet: {
                id_str: "1800000000000000001",
                full_text: "第一行 &amp; 第二行<br>第三行",
                created_at: "Wed Oct 10 20:19:24 +0000 2018",
                lang: "zh",
                favorite_count: 12,
                retweet_count: 3,
                conversation_count: 4,
                in_reply_to_status_id_str: null,
                user: {
                  name: "上海 Paul",
                  screen_name: "ShanghaiPaul",
                  profile_image_url_https: "https://pbs.twimg.com/avatar.jpg",
                },
                mediaDetails: [
                  {
                    type: "photo",
                    media_url_https: "https://pbs.twimg.com/media/photo.jpg",
                    original_sizes: { width: 1200, height: 800 },
                  },
                ],
                quoted_tweet: {
                  id_str: "1700000000000000002",
                  full_text: "被引用的正文 &lt;tag&gt;",
                  user: {
                    name: "另一位作者",
                    screen_name: "other",
                    profile_image_url_https: "https://pbs.twimg.com/other.jpg",
                  },
                  mediaDetails: [],
                },
              },
            },
          },
        ],
      },
    },
  },
};

/** The page the endpoint answers with: the JSON in a script the reader looks for. */
const PAGE = [
  "<!DOCTYPE html><html><body>",
  "<script id=" + QUOTE + "__NEXT_DATA__" + QUOTE + " type=" + QUOTE + "application/json" + QUOTE + ">",
  JSON.stringify(DATA),
  "</script></body></html>",
].join("");

test("时间线的地址带着账号名，特殊字符被转义", () => {
  assert.equal(
    syndicationUrl("ShanghaiPaul"),
    "https://syndication.twitter.com/srv/timeline-profile/screen-name/ShanghaiPaul",
  );
  assert.equal(
    syndicationUrl("a b/c"),
    "https://syndication.twitter.com/srv/timeline-profile/screen-name/a%20b%2Fc",
  );
});

test("页面里的账号和推文都被读出来", () => {
  const profile = parseSyndicationProfile(PAGE);
  assert.equal(profile.screenName, "ShanghaiPaul");
  assert.equal(profile.displayName, "上海 Paul");
  assert.equal(profile.entries.length, 1);
  const entry = profile.entries[0];
  assert.ok(entry);
  assert.equal(entry.tweetId, "1800000000000000001");
  assert.equal(entry.text, "第一行 & 第二行\n第三行");
  assert.equal(entry.createdAt, "Wed Oct 10 20:19:24 +0000 2018");
  assert.equal(entry.lang, "zh");
  assert.equal(entry.authorName, "上海 Paul");
  assert.equal(entry.handle, "ShanghaiPaul");
  assert.equal(entry.avatarUrl, "https://pbs.twimg.com/avatar.jpg");
  assert.equal(entry.favorite, 12);
  assert.equal(entry.retweet, 3);
  assert.equal(entry.replyCount, 4);
  assert.equal(entry.replyTo, null);
  assert.equal(entry.media.length, 1);
  assert.equal(entry.media[0].kind, "image");
  assert.equal(entry.media[0].url, "https://pbs.twimg.com/media/photo.jpg");
  assert.equal(entry.media[0].width, 1200);
  assert.equal(entry.media[0].height, 800);
  assert.equal(entry.media[0].poster, null);
  assert.ok(entry.quoted);
  assert.equal(entry.quoted?.authorName, "另一位作者");
  assert.equal(entry.quoted?.handle, "other");
  assert.equal(entry.quoted?.text, "被引用的正文 <tag>");
  assert.equal(entry.quoted?.url, "https://x.com/other/status/1700000000000000002");
  assert.deepEqual(entry.quoted?.media, []);
});

test("页面没写的字段留空，不抛错", () => {
  const data = {
    props: {
      pageProps: {
        headerProps: { screenName: "someone" },
        timeline: { entries: [{ content: { tweet: { id: 42, text: "只有一句话" } } }] },
      },
    },
  };
  const page = [
    "<script id=" + QUOTE + "__NEXT_DATA__" + QUOTE + ">",
    JSON.stringify(data),
    "</script>",
  ].join("");
  const profile = parseSyndicationProfile(page);
  assert.equal(profile.screenName, "someone");
  assert.equal(profile.displayName, null);
  assert.equal(profile.entries.length, 1);
  const entry = profile.entries[0];
  assert.ok(entry);
  assert.equal(entry.tweetId, "42");
  assert.equal(entry.text, "只有一句话");
  assert.equal(entry.createdAt, null);
  assert.equal(entry.lang, null);
  assert.equal(entry.replyTo, null);
  assert.equal(entry.avatarUrl, null);
  assert.equal(entry.favorite, null);
  assert.equal(entry.retweet, null);
  assert.equal(entry.replyCount, null);
  assert.deepEqual(entry.media, []);
  assert.equal(entry.quoted, null);
});

test("没有 __NEXT_DATA__ 的页面读成空，不抛错", () => {
  const profile = parseSyndicationProfile("<html><body>没有脚本</body></html>");
  assert.deepEqual(profile, { screenName: null, displayName: null, entries: [] });
});

test("__NEXT_DATA__ 里的 JSON 坏了也读成空，不抛错", () => {
  const page = "<script id=" + QUOTE + "__NEXT_DATA__" + QUOTE + ">{不是 JSON}</script>";
  const profile = parseSyndicationProfile(page);
  assert.deepEqual(profile, { screenName: null, displayName: null, entries: [] });
});

test("没有代理地址时采集器直接说没有代理，不发请求", async () => {
  const result = await collectSyndication({
    sourceId: "x-timeline",
    handle: "ShanghaiPaul",
    proxyUrl: "",
  });
  assert.equal(result.status, 0);
  assert.equal(result.found, 0);
  assert.equal(result.created, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.error, "还没有配置代理地址");
});
