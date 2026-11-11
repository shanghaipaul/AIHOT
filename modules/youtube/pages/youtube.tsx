// The youtube list: the newest videos of the AI channels the module watches, each with the Chinese
// summary and the points the model took from its transcript. The page reads the api's /api/youtube
// and draws an empty state when the feed has not been collected yet, so a reader never meets a 500
// where a page should be.
import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { Badge } from "@aihot/web/components/ui/Badge";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { apiGet, cachedPage, pageHeaders } from "@aihot/web/lib/api.server";
import { relativeTime } from "@aihot/web/lib/format";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import type { YoutubeFeed, YoutubeVideo } from "../backend/types.ts";

export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  const channel = new URL(request.url).searchParams.get("channel") ?? "";
  const query = channel ? "?channel=" + encodeURIComponent(channel) : "";
  const upstream = new Headers();
  try {
    const feed = await apiGet<YoutubeFeed>("/api/youtube" + query, {
      signal: request.signal,
      responseHeaders: upstream,
    });
    return cachedPage(600, { feed, channel, unavailable: false }, upstream);
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    return cachedPage(60, { feed: null, channel, unavailable: true }, upstream);
  }
}

export function meta() {
  return pageMeta({
    title: "YouTube 视频",
    description: "追踪 AI 频道的新视频：自动抓取字幕并生成中文摘要，列出要点与话题。",
    path: "/youtube",
  });
}

/** "12:34" or "1:02:03"; a video of unknown length has no duration to show. */
function durationOf(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? hours + ":" + two(minutes) + ":" + two(rest) : minutes + ":" + two(rest);
}

/** A view count in Chinese units: "12.3 万". */
function viewsOf(count: number | null): string | null {
  if (count === null) return null;
  if (count >= 100000000) return (count / 100000000).toFixed(1) + " 亿";
  if (count >= 10000) return (count / 10000).toFixed(1) + " 万";
  return count.toLocaleString("zh-CN");
}

/** The picture of a video: what the api brought, or YouTube's own picture of it. */
function thumbOf(video: YoutubeVideo): string {
  return video.thumbnail ?? "https://i.ytimg.com/vi/" + video.videoId + "/hqdefault.jpg";
}

/** The video's own words: read on demand, shown in full, and kept with one click. */
function SubtitlePanel({ video }: { video: YoutubeVideo }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "missing" | "error">("idle");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!video.transcriptAvailable) {
    return <p className="text-[11.5px] text-ink-4">暂无字幕</p>;
  }

  /** Ask the api for the text of this video; the answer is plain text in a json envelope. */
  async function openText(): Promise<void> {
    setOpen(true);
    if (status === "loading" || status === "ready" || status === "missing") return;
    setStatus("loading");
    try {
      const res = await fetch("/api/youtube/subtitles/" + encodeURIComponent(video.videoId) + "?format=json", {
        headers: { accept: "application/json" },
      });
      if (res.status === 404) {
        setStatus("missing");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const body = (await res.json()) as { contentText?: string; language?: string | null };
      setText(String(body?.contentText ?? ""));
      setLanguage(body?.language ?? null);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  /** Put the whole text on the clipboard, so a reader can keep it. */
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-2 border-t border-line-soft pt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : void openText())}
          className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
        >
          {open ? "收起字幕" : "查看字幕全文"}
        </button>
        <a
          href={"/api/youtube/subtitles/" + encodeURIComponent(video.videoId) + "?format=txt"}
          download
          className="text-[11.5px] text-accent hover:underline"
        >
          下载字幕
        </a>
      </div>
      {open && (
        <div className="mt-2 rounded-card bg-bg-sunk p-3">
          {status === "loading" && <p className="text-[12px] text-ink-4">正在读取字幕……</p>}
          {status === "idle" && <p className="text-[12px] text-ink-4">字幕还没读出来。</p>}
          {status === "missing" && <p className="text-[12px] text-ink-4">这条视频没有字幕。</p>}
          {status === "error" && <p className="text-[12px] text-hot">字幕暂时读不到，过一会儿再试。</p>}
          {status === "ready" && (
            <>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[11.5px] text-ink-4">{language ? "语言 " + language : "字幕全文"}</span>
                <button type="button" onClick={() => void copy()} className="text-[11.5px] text-accent hover:underline">
                  {copied ? "已复制" : "复制全文"}
                </button>
              </div>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink-2">
                {text}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One video: its picture, its title (which opens it on YouTube), its numbers, and what the model wrote. */
function VideoCard({ video }: { video: YoutubeVideo }) {
  const duration = durationOf(video.durationSeconds);
  const views = viewsOf(video.viewCount);
  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
      <a href={video.url} target="_blank" rel="noreferrer noopener" tabIndex={-1} aria-hidden="true" className="block">
        <img
          src={thumbOf(video)}
          alt={video.title}
          loading="lazy"
          decoding="async"
          className="aspect-[16/9] w-full object-cover"
        />
      </a>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <a
          href={video.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[14px] font-semibold leading-snug text-ink hover:text-accent hover:underline"
        >
          {video.title}
        </a>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-4">
          <span className="max-w-xs truncate" title={video.channelTitle}>
            {video.channelTitle}
          </span>
          {video.publishedAt && (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={video.publishedAt} suppressHydrationWarning>
                {relativeTime(video.publishedAt)}
              </time>
            </>
          )}
          {duration && (
            <>
              <span aria-hidden="true">·</span>
              <span className="num">{duration}</span>
            </>
          )}
          {views && (
            <>
              <span aria-hidden="true">·</span>
              <span className="num">{views} 次播放</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {video.transcriptAvailable ? (
            <Badge tone="ok">含字幕</Badge>
          ) : (
            <Badge tone="neutral">无字幕（仅标题摘要）</Badge>
          )}
          {video.topics.slice(0, 6).map((topic) => (
            <Badge key={topic}>{topic}</Badge>
          ))}
        </div>
        {video.summary && (
          <p className="line-clamp-3 text-[13px] leading-relaxed text-ink-3">{video.summary}</p>
        )}
        {video.keyPoints.length > 0 && (
          <ul className="space-y-1 text-[12.5px] leading-relaxed text-ink-3">
            {video.keyPoints.slice(0, 5).map((point, index) => (
              <li key={index} className="flex gap-1.5">
                <span aria-hidden="true" className="shrink-0 text-ink-4">
                  ·
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
        <SubtitlePanel video={video} />
      </div>
    </li>
  );
}

export default function YoutubePage() {
  const { feed, channel, unavailable } = useLoaderData<typeof loader>();
  const channels = feed?.channels ?? [];
  const videos = feed?.videos ?? [];
  const pill = (active: boolean) =>
    "rounded-full px-3 py-1 text-[12.5px] transition-colors " +
    (active ? "bg-accent text-accent-contrast" : "border border-line text-ink-3 hover:text-ink");

  const title = (
    <header className="pb-2 pt-3 lg:pt-1">
      <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">
        YouTube 视频
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
        追踪 AI 频道的新视频，自动抓取字幕并生成中文摘要：每个视频给出要点、话题和播放信息。
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
        不想看视频？{" "}
        <Link to="/youtube/transcripts" className="text-accent hover:underline">
          字幕库
        </Link>{" "}
        里有全部字幕的全文，可以直接读，也可以整包下载。
      </p>
    </header>
  );

  return (
    <div className="pb-10">
      {title}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Link to="/youtube" aria-current={channel ? undefined : "page"} className={pill(!channel)}>
          全部
        </Link>
        {channels.map((item) => {
          const active = channel === item.channelId;
          return (
            <Link
              key={item.channelId}
              to={"/youtube?channel=" + encodeURIComponent(item.channelId)}
              aria-current={active ? "page" : undefined}
              className={pill(active)}
            >
              {item.title}
            </Link>
          );
        })}
        {feed && <span className="num text-[12px] text-ink-4">共 {videos.length} 个视频</span>}
        {feed?.updatedAt && (
          <span className="text-[12px] text-ink-4">更新于 {relativeTime(feed.updatedAt)}</span>
        )}
      </div>

      {!feed ? (
        <EmptyState title="视频列表暂时读不到">
          {unavailable ? "站点还没有连上视频接口，过一会儿再来。" : "还没有内容。"}
        </EmptyState>
      ) : videos.length === 0 ? (
        <EmptyState title={channel ? "这个频道还没有视频" : "还没有视频"}>
          采集任务会在下一个周期把新视频带进来。
        </EmptyState>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {videos.map((video) => (
            <VideoCard key={video.videoId} video={video} />
          ))}
        </ul>
      )}

      <p className="mt-8 text-[12px] leading-relaxed text-ink-4">
        视频元数据来自 YouTube 频道页与 Invidious 公共实例，字幕与摘要由模型生成；内容版权归原作者，摘要仅供参考。
      </p>
    </div>
  );
}
