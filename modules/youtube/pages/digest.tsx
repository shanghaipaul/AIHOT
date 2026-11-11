// The digest of the subtitles: the model reads one whole video and leaves what matters — a single line
// of conclusion, the points, the numbers it heard, the products it named, who the video fits and where
// it is careful. The page reads the api's /api/youtube/digests; an administrator can build the ones
// that are missing and take the whole set away as one markdown file.
import { useState } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { Badge } from "@aihot/web/components/ui/Badge";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { apiGet, cachedPage, pageHeaders } from "@aihot/web/lib/api.server";
import { relativeTime } from "@aihot/web/lib/format";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";

export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

/** One number the video said out loud, with the note the model wrote next to it. */
interface DigestDataPoint {
  label: string;
  value: string;
  note?: string | null;
}

/** One product or model the video mentioned. */
interface DigestEntity {
  name: string;
  note?: string | null;
}

/** What the model wrote about one video. */
interface YoutubeDigest {
  videoId: string;
  channelId?: string | null;
  channelTitle?: string | null;
  title: string;
  url: string;
  durationSeconds?: number | null;
  publishedAt?: string | null;
  oneLiner?: string | null;
  summary?: string | null;
  keyPoints?: string[] | null;
  dataPoints?: DigestDataPoint[] | null;
  entities?: DigestEntity[] | null;
  audience?: string | null;
  caveats?: string[] | null;
  model?: string | null;
  updatedAt?: string | null;
}

/** How the work goes: how many videos there are, how many are done and how many are waiting. */
interface DigestStats {
  total: number;
  done: number;
  blocked: number;
  pending: number;
}

/** What the api answers for the whole digest. */
interface DigestsPayload {
  digests?: YoutubeDigest[] | null;
  stats?: DigestStats | null;
}

export async function loader({ request }: { request: Request }) {
  const upstream = new Headers();
  try {
    const payload = await apiGet<DigestsPayload>("/api/youtube/digests", {
      signal: request.signal,
      responseHeaders: upstream,
    });
    return cachedPage(60, { payload, unavailable: false }, upstream);
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    // The digests are not ready yet: the page says so instead of failing.
    return cachedPage(60, { payload: null, unavailable: true }, upstream);
  }
}

export function meta() {
  return pageMeta({
    title: "YouTube 字幕精华提炼",
    description: "把 AI 视频的字幕压成一句话结论、关键要点、关键数据与注意事项，读完就知道这条视频值不值得看。",
    path: "/youtube/digest",
  });
}

/** "12:34" or "1:02:03"; a video of unknown length has no duration to show. */
function durationOf(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? hours + ":" + two(minutes) + ":" + two(rest) : minutes + ":" + two(rest);
}

/** One digest: the conclusion, the points, the numbers, the names and the care the model took. */
function DigestCard({ digest }: { digest: YoutubeDigest }) {
  const duration = durationOf(digest.durationSeconds);
  const keyPoints = digest.keyPoints ?? [];
  const dataPoints = digest.dataPoints ?? [];
  const entities = digest.entities ?? [];
  const caveats = digest.caveats ?? [];

  return (
    <li className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4">
      <div>
        <a
          href={digest.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[15px] font-semibold leading-snug text-ink hover:text-accent hover:underline"
        >
          {digest.title}
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-4">
          {digest.channelTitle && (
            <span className="max-w-xs truncate" title={digest.channelTitle}>
              {digest.channelTitle}
            </span>
          )}
          {digest.publishedAt && (
            <time dateTime={digest.publishedAt} suppressHydrationWarning>
              {relativeTime(digest.publishedAt)}
            </time>
          )}
          {duration && <span className="num">{duration}</span>}
          {digest.model && <Badge tone="neutral">模型 {digest.model}</Badge>}
        </div>
      </div>

      {digest.oneLiner && (
        <p className="text-[13.5px] font-medium leading-relaxed text-ink-2">「{digest.oneLiner}」</p>
      )}
      {digest.summary && <p className="text-[13px] leading-relaxed text-ink-3">{digest.summary}</p>}

      {keyPoints.length > 0 && (
        <section>
          <h3 className="text-[12px] font-semibold text-ink-2">关键要点</h3>
          <ul className="mt-1 space-y-1 text-[12.5px] leading-relaxed text-ink-3">
            {keyPoints.map((point, index) => (
              <li key={index} className="flex gap-1.5">
                <span aria-hidden="true" className="shrink-0 text-ink-4">
                  ·
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dataPoints.length > 0 && (
        <section>
          <h3 className="text-[12px] font-semibold text-ink-2">关键数据</h3>
          <table className="mt-1 w-full border-collapse text-left text-[12.5px]">
            <tbody>
              {dataPoints.map((point, index) => (
                <tr key={index} className="border-b border-line-soft last:border-b-0">
                  <th scope="row" className="w-[38%] py-1.5 pr-3 align-top font-medium text-ink-3">
                    {point.label}
                  </th>
                  <td className="py-1.5 align-top text-ink-2">
                    <span className="num">{point.value}</span>
                    {point.note && <span className="mt-0.5 block text-[11.5px] text-ink-4">{point.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {entities.length > 0 && (
        <section>
          <h3 className="text-[12px] font-semibold text-ink-2">提到的产品与模型</h3>
          <ul className="mt-1 flex flex-wrap items-center gap-1.5">
            {entities.map((entity, index) => (
              <li key={index} className="flex items-center gap-1">
                <Badge tone="accent" title={entity.note ?? undefined}>
                  {entity.name}
                </Badge>
                {entity.note && <span className="text-[11.5px] text-ink-4">{entity.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {digest.audience && (
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          <span className="font-medium text-ink-2">适合谁：</span>
          {digest.audience}
        </p>
      )}

      {caveats.length > 0 && (
        <section>
          <h3 className="text-[12px] font-semibold text-ink-2">注意事项</h3>
          <ul className="mt-1 space-y-1 text-[12.5px] leading-relaxed text-ink-3">
            {caveats.map((caveat, index) => (
              <li key={index} className="flex gap-1.5">
                <span aria-hidden="true" className="shrink-0 text-ink-4">
                  ·
                </span>
                <span>{caveat}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-4">
        <a href={digest.url} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
          看原视频
        </a>
        {digest.updatedAt && (
          <time dateTime={digest.updatedAt} suppressHydrationWarning>
            提炼于 {relativeTime(digest.updatedAt)}
          </time>
        )}
      </div>
    </li>
  );
}

export default function DigestPage() {
  const { payload, unavailable } = useLoaderData<typeof loader>();
  const digests = payload?.digests ?? [];
  const stats = payload?.stats ?? null;

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const revalidator = useRevalidator();

  /** Ask the api to read the subtitles that have no digest yet. Only an administrator may do it. */
  async function build(): Promise<void> {
    setBusy(true);
    setNote(null);
    try {
      const me = await fetch("/api/admin/me", { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!me.ok) {
        setNote("提炼需要管理员身份：请先用管理员账号登录，再点一次这个按钮。");
        return;
      }
      const meJson = (await me.json()) as { csrf?: string };
      const csrf = String(meJson?.csrf ?? "");
      if (!csrf) {
        setNote("没有拿到登录凭证，请重新登录后再试。");
        return;
      }
      const res = await fetch("/api/youtube/digests/build", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrf },
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        built?: number;
        skipped?: number;
        failed?: number;
      };
      if (!res.ok) {
        setNote("提炼没有成功：" + (body.error ?? "HTTP " + res.status));
        return;
      }
      setNote(
        "提炼跑完：新提炼 " +
          (body.built ?? 0) +
          " 篇，跳过 " +
          (body.skipped ?? 0) +
          " 篇，失败 " +
          (body.failed ?? 0) +
          " 篇。",
      );
      revalidator.revalidate();
    } catch (error) {
      setNote("提炼失败：" + String((error as Error)?.message ?? error));
    } finally {
      setBusy(false);
    }
  }

  const toolbarButton =
    "rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink";

  return (
    <div className="pb-10">
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">
          字幕精华提炼
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          把每条视频的字幕读成结论、要点、关键数据与注意事项：三十秒看完一条视频在讲什么。
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          想要原话？{" "}
          <Link to="/youtube/transcripts" className="text-accent hover:underline">
            字幕库
          </Link>{" "}
          里有全文；回到{" "}
          <Link to="/youtube" className="text-accent hover:underline">
            视频列表
          </Link>{" "}
          看全部视频。
        </p>
      </header>

      {stats && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-card border border-line bg-surface px-3 py-2">
            <div className="num text-[18px] font-semibold leading-tight text-ink">{stats.done}</div>
            <div className="mt-0.5 text-[11.5px] text-ink-4">已提炼</div>
          </div>
          <div className="rounded-card border border-line bg-surface px-3 py-2">
            <div className="num text-[18px] font-semibold leading-tight text-ink">{stats.total}</div>
            <div className="mt-0.5 text-[11.5px] text-ink-4">有字幕共</div>
          </div>
          <div className="rounded-card border border-line bg-surface px-3 py-2">
            <div className="num text-[18px] font-semibold leading-tight text-ink">{stats.pending}</div>
            <div className="mt-0.5 text-[11.5px] text-ink-4">待提炼</div>
          </div>
          <div className="rounded-card border border-line bg-surface px-3 py-2">
            <div className="num text-[18px] font-semibold leading-tight text-ink">{stats.blocked}</div>
            <div className="mt-0.5 text-[11.5px] text-ink-4">受阻</div>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={build} disabled={busy} className={toolbarButton}>
          {busy ? "正在提炼…" : "提炼全部"}
        </button>
        <a href="/api/youtube/digests/export?format=md" download className={toolbarButton}>
          下载 Markdown
        </a>
        <Link to="/youtube/transcripts" className={toolbarButton}>
          去字幕库
        </Link>
        {payload && (
          <span className="num text-[12px] text-ink-4">
            {digests.length} 篇提炼
            {stats && stats.pending > 0 ? " · " + stats.pending + " 篇待提炼" : ""}
          </span>
        )}
      </div>

      {note && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{note}</p>}

      {!payload ? (
        <EmptyState title="提炼暂时读不到">
          {unavailable ? "站点还没有连上视频接口，过一会儿再来。" : "还没有内容。"}
        </EmptyState>
      ) : digests.length === 0 ? (
        <EmptyState
          title="还没有提炼"
          action={
            <button
              type="button"
              onClick={build}
              disabled={busy}
              className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
            >
              {busy ? "正在提炼…" : "提炼全部"}
            </button>
          }
        >
          字幕齐了以后点「提炼全部」，模型会把每条视频读成结论、要点、关键数据和注意事项。
        </EmptyState>
      ) : (
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {digests.map((digest) => (
            <DigestCard key={digest.videoId} digest={digest} />
          ))}
        </ul>
      )}

      <p className="mt-8 text-[12px] leading-relaxed text-ink-4">
        提炼来自视频字幕，由模型生成，可能有偏差；关键数据请以视频原话为准，版权归原作者。
      </p>
    </div>
  );
}
