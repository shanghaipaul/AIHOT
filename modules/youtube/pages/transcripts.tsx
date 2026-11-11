// The subtitle library: the texts of the videos the module watches, so a reader can read what was said
// instead of watching the video. The page reads the api's /api/youtube for the list and the api's
// /api/youtube/subtitles for the text of the chosen video, and offers the whole archive as one file to
// keep on the disk.
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

/** What the api answers for one subtitle. */
interface SubtitlePayload {
  videoId: string;
  language: string | null;
  provider: string | null;
  fetchedAt: string | null;
  contentText: string;
}

export async function loader({ request }: { request: Request }) {
  const wanted = new URL(request.url).searchParams.get("video") ?? "";
  const upstream = new Headers();
  try {
    const feed = await apiGet<YoutubeFeed>("/api/youtube", {
      signal: request.signal,
      responseHeaders: upstream,
    });
    const chosen = feed.videos.find((video) => video.videoId === wanted) ?? null;
    let subtitle: SubtitlePayload | null = null;
    if (chosen) {
      try {
        subtitle = await apiGet<SubtitlePayload>(
          "/api/youtube/subtitles/" + encodeURIComponent(chosen.videoId) + "?format=json",
          { signal: request.signal },
        );
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") throw error;
        // No subtitle for this one: the panel says so instead of failing the page.
        subtitle = null;
      }
    }
    return cachedPage(60, { feed, chosenId: chosen?.videoId ?? "", subtitle, unavailable: false }, upstream);
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    return cachedPage(60, { feed: null, chosenId: "", subtitle: null, unavailable: true }, upstream);
  }
}

export function meta() {
  return pageMeta({
    title: "YouTube 字幕库",
    description: "AI 视频的字幕全文都在这里：选中一条直接读，也能把全部字幕下载成 Markdown 或 TXT。",
    path: "/youtube/transcripts",
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

/** One line of the list: the video, its channel, when it came out and how long it is. */
function VideoRow({ video, active }: { video: YoutubeVideo; active: boolean }) {
  const duration = durationOf(video.durationSeconds);
  return (
    <li>
      <Link
        to={"/youtube/transcripts?video=" + encodeURIComponent(video.videoId)}
        aria-current={active ? "page" : undefined}
        className={
          "block rounded-card border px-3 py-2.5 transition-colors " +
          (active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong")
        }
      >
        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">{video.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-4">
          <span className="max-w-[11rem] truncate">{video.channelTitle}</span>
          {video.publishedAt && (
            <time dateTime={video.publishedAt} suppressHydrationWarning>
              {relativeTime(video.publishedAt)}
            </time>
          )}
          {duration && <span className="num">{duration}</span>}
        </span>
        {!video.transcriptAvailable && (
          <span className="mt-1 inline-block text-[11px] text-ink-4">缺字幕</span>
        )}
      </Link>
    </li>
  );
}

export default function TranscriptsPage() {
  const { feed, chosenId, subtitle, unavailable } = useLoaderData<typeof loader>();
  const videos = feed?.videos ?? [];
  const withSubtitle = videos.filter((video) => video.transcriptAvailable).length;
  const missing = videos.length - withSubtitle;
  const chosen = videos.find((video) => video.videoId === chosenId) ?? null;

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /** Ask the api to fill in the subtitles that are missing. Only an administrator may do it. */
  async function backfill(): Promise<void> {
    setBusy(true);
    setNote(null);
    try {
      const me = await fetch("/api/admin/me", { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!me.ok) {
        setNote("补齐字幕要管理员身份：请先用管理员账号登录，再点一次这个按钮。");
        return;
      }
      const meJson = (await me.json()) as { csrf?: string };
      const csrf = String(meJson?.csrf ?? "");
      if (!csrf) {
        setNote("没有拿到登录凭证，请重新登录后再试。");
        return;
      }
      const res = await fetch("/api/youtube/subtitles/backfill", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrf },
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setNote("补齐字幕没有成功：" + (body.error ?? "HTTP " + res.status));
        return;
      }
      setNote("补齐任务已经跑完。刷新这个页面就能看到新字幕。");
    } catch (error) {
      setNote("补齐字幕失败：" + String((error as Error)?.message ?? error));
    } finally {
      setBusy(false);
    }
  }

  /** Put the whole text on the clipboard, so a reader can keep it. */
  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNote("这个浏览器不让脚本写剪贴板，请手动选中文字复制。");
    }
  }

  const toolbarButton =
    "rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink";

  return (
    <div className="pb-10">
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">
          YouTube 字幕库
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          视频里的原话都在这里：左边选一条，右边直接读全文；也可以把全部字幕一次下载到本地。
        </p>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a href="/api/youtube/subtitles/export?format=md" download className={toolbarButton}>
          下载全部字幕 (.md)
        </a>
        <a href="/api/youtube/subtitles/export?format=txt" download className={toolbarButton}>
          下载全部字幕 (.txt)
        </a>
        <button type="button" onClick={backfill} disabled={busy} className={toolbarButton}>
          {busy ? "正在补齐…" : "补齐缺失字幕"}
        </button>
        <Link to="/youtube" className={toolbarButton}>
          回到视频列表
        </Link>
        {feed && (
          <span className="num text-[12px] text-ink-4">
            {videos.length} 个视频 · {withSubtitle} 条字幕
            {missing > 0 ? " · " + missing + " 条待补齐" : ""}
          </span>
        )}
      </div>

      {note && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{note}</p>}

      {!feed ? (
        <EmptyState title="字幕库暂时读不到">
          {unavailable ? "站点还没有连上视频接口，过一会儿再来。" : "还没有内容。"}
        </EmptyState>
      ) : videos.length === 0 ? (
        <EmptyState title="还没有视频">采集任务会在下一个周期把新视频带进来，字幕也会跟着来。</EmptyState>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className="lg:max-h-[70vh] lg:overflow-y-auto">
            <h2 className="mb-2 text-[13px] font-medium text-ink-2">视频（{videos.length}）</h2>
            <ul className="flex flex-col gap-2">
              {videos.map((video) => (
                <VideoRow key={video.videoId} video={video} active={video.videoId === chosenId} />
              ))}
            </ul>
          </div>

          <div className="min-w-0">
            {!chosen ? (
              <EmptyState title="选一条视频看字幕全文">
                左边点一条视频，它的字幕就会在这里展开。
              </EmptyState>
            ) : !subtitle ? (
              <div className="rounded-card border border-line bg-surface p-4">
                <h2 className="text-[15px] font-semibold leading-snug text-ink">{chosen.title}</h2>
                <p className="mt-2 text-[13px] text-ink-3">这条视频还没有字幕。点上面的「补齐缺失字幕」可以去找一份。</p>
                <a
                  href={chosen.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 inline-block text-[12.5px] text-accent hover:underline"
                >
                  在 YouTube 上看这条视频
                </a>
              </div>
            ) : (
              <div className="rounded-card border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="min-w-0 text-[15px] font-semibold leading-snug text-ink">{chosen.title}</h2>
                  <button
                    type="button"
                    onClick={() => copy(subtitle.contentText)}
                    className="shrink-0 rounded-full border border-line px-3 py-1 text-[12px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
                  >
                    {copied ? "已复制" : "复制全文"}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone="ok">含字幕</Badge>
                  <span className="text-[12px] text-ink-4">{chosen.channelTitle}</span>
                  {subtitle.language && <span className="text-[12px] text-ink-4">语言 {subtitle.language}</span>}
                  {subtitle.provider && <span className="text-[12px] text-ink-4">来源 {subtitle.provider}</span>}
                  {subtitle.fetchedAt && (
                    <time className="text-[12px] text-ink-4" dateTime={subtitle.fetchedAt} suppressHydrationWarning>
                      抓于 {relativeTime(subtitle.fetchedAt)}
                    </time>
                  )}
                  <a
                    href={"/api/youtube/subtitles/" + encodeURIComponent(chosen.videoId) + "?format=txt"}
                    download
                    className="text-[12px] text-accent hover:underline"
                  >
                    下载这条字幕
                  </a>
                  <a
                    href={chosen.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[12px] text-accent hover:underline"
                  >
                    看视频
                  </a>
                </div>
                <pre className="mt-3 max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-card bg-bg-sunk p-3 text-[13px] leading-relaxed text-ink-2">
                  {subtitle.contentText}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="mt-8 text-[12px] leading-relaxed text-ink-4">
        字幕来自视频自带的轨道与公共实例，版权归原作者；合订本方便离线阅读，请勿二次分发。
      </p>
    </div>
  );
}
