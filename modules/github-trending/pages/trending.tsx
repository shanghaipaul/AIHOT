// The trending list: the repositories GitHub shows for a period, in its own order. It reads the api's
// /api/github-trending and draws an empty state when the list has not been read yet, so a reader never
// meets a 500 where a page should be.
import { Link, useLoaderData, useSearchParams } from "react-router";
import { Badge } from "@aihot/web/components/ui/Badge";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { apiGet, cachedPage, pageHeaders } from "@aihot/web/lib/api.server";
import { relativeTime } from "@aihot/web/lib/format";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import { describeOf, type TrendingSnapshot } from "../backend/types.ts";

export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

const PERIODS = [
  { key: "daily", label: "今日", gain: "今日" },
  { key: "weekly", label: "本周", gain: "本周" },
  { key: "monthly", label: "本月", gain: "本月" },
] as const;

export async function loader({ request }: { request: Request }) {
  const period = new URL(request.url).searchParams.get("period") ?? "daily";
  const upstream = new Headers();
  try {
    const response = await apiGet<TrendingSnapshot>("/api/github-trending?period=" + encodeURIComponent(period), {
      signal: request.signal,
      responseHeaders: upstream,
    });
    return cachedPage(600, { snapshot: response, unavailable: false }, upstream);
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    return cachedPage(60, { snapshot: null, unavailable: true }, upstream);
  }
}

export function meta() {
  return pageMeta({
    title: "GitHub 趋势榜",
    description: "GitHub 上此刻最热的开源仓库：今日、本周、本月三个周期，按 GitHub 自己的榜单。",
    path: "/github-trending",
  });
}

const num = (value: number | null): string => (value === null ? "—" : value.toLocaleString("zh-CN"));

/** One repository: its place, its name (which opens it on GitHub), its numbers and its one line. */
function Repo({ repo, gain }: { repo: TrendingSnapshot["repos"][number]; gain: string }) {
  return (
    <li className="flex gap-3 py-3 pl-4 pr-3 lg:items-start lg:rounded-card lg:border lg:border-line lg:bg-surface lg:px-5 lg:py-4">
      <span className="num w-5 shrink-0 pt-0.5 text-[13px] font-bold text-ink-4">{repo.rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <a
            href={repo.url}
            target="_blank"
            rel="noreferrer noopener"
            className="truncate text-[14px] font-semibold text-ink underline-offset-2 hover:text-accent hover:underline"
          >
            {repo.repo}
          </a>
          {repo.language && <Badge tone="neutral">{repo.language}</Badge>}
          <span className="num text-[12px] text-ink-4">{num(repo.stars)} 星标</span>
          {repo.starsPeriod !== null && (
            <span className="num text-[12px] font-medium text-accent">
              {gain} +{num(repo.starsPeriod)}
            </span>
          )}
        </div>
        {describeOf(repo) && (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-3" title={repo.description ?? undefined}>
            {describeOf(repo)}
          </p>
        )}
      </div>
    </li>
  );
}

export default function TrendingPage() {
  const { snapshot, unavailable } = useLoaderData<typeof loader>();
  const [search] = useSearchParams();
  const period = snapshot?.period ?? (search.get("period") === "weekly" || search.get("period") === "monthly" ? search.get("period")! : "daily");
  const gain = PERIODS.find((option) => option.key === period)?.gain ?? "今日";
  const title = (
    <header className="pb-2 pt-3 lg:pt-1">
      <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">GitHub 趋势</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
        GitHub 自己排的开源仓库热榜：今日、本周、本月三个周期，看谁在被点亮。仓库简介由模型译成中文，鼠标悬停可看英文原文。
      </p>
    </header>
  );
  return (
    <div className="pb-10">
      {title}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {PERIODS.map((option) => {
          const active = period === option.key;
          return (
            <Link
              key={option.key}
              to={"/github-trending?period=" + option.key}
              className={"rounded-full px-3 py-1 text-[12.5px] transition-colors " + (active ? "bg-ink text-surface" : "border border-line text-ink-3 hover:text-ink")}
            >
              {option.label}
            </Link>
          );
        })}
        {snapshot?.fetchedAt && (
          <span className="ml-1 text-[12px] text-ink-4">更新于 {relativeTime(snapshot.fetchedAt)}</span>
        )}
      </div>
      {!snapshot ? (
        <EmptyState title="榜单暂时读不到">
          {unavailable ? "站点还没有连上榜单接口，过一会儿再来。" : "还没有内容。"}
        </EmptyState>
      ) : snapshot.repos.length === 0 ? (
        <EmptyState title="这个周期还没有榜单">
          榜单每两小时从 GitHub 读一次，读到之后这里就是最新的那份。
        </EmptyState>
      ) : (
        <ul className="mt-2 divide-y divide-line-soft">
          {snapshot.repos.map((repo) => (
            <Repo key={repo.repo} repo={repo} gain={gain} />
          ))}
        </ul>
      )}
    </div>
  );
}