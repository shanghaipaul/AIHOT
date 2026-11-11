// The timeline of the X account the module watches: the posts it collected, with the pictures that came
// with them and a link to the original. The page reads the api's /api/x-timeline and draws an empty state
// when the account is not configured yet, so a reader never meets a 500 where a page should be.
import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { Badge } from "@aihot/web/components/ui/Badge";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { apiGet, cachedPage, pageHeaders } from "@aihot/web/lib/api.server";
import { relativeTime } from "@aihot/web/lib/format";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";

export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

/** A picture or a video of a post, as the api answers it. */
export interface XMedia {
  kind?: string | null;
  url?: string | null;
  poster?: string | null;
}

/** The post another post quotes. */
export interface XQuoted {
  authorName?: string | null;
  handle?: string | null;
  text?: string | null;
  url?: string | null;
}

/** One post, as the api answers it. */
export interface XPost {
  id?: string;
  url?: string | null;
  title?: string | null;
  text?: string | null;
  excerpt?: string | null;
  publishedAt?: string | null;
  lang?: string | null;
  authorName?: string | null;
  handle?: string | null;
  media?: XMedia[] | null;
  quoted?: XQuoted | null;
  heat?: { favorite?: number | null; retweet?: number | null; views?: number | null } | null;
}

/** The source the collector reads from, as the api answers it. */
export interface XSource {
  id?: string;
  name?: string | null;
  kind?: string | null;
  enabled?: boolean;
  health?: string | null;
  intervalMinutes?: number | null;
  query?: string | null;
  searchType?: string | null;
  lastFetchAt?: string | null;
  lastOkAt?: string | null;
  lastError?: string | null;
}

/** The whole answer of GET /api/x-timeline. */
export interface XTimelineFeed {
  configured?: boolean;
  handle?: string | null;
  mode?: string | null;
  hasKey?: boolean;
  source?: XSource | null;
  posts?: XPost[] | null;
}

export async function loader({ request }: { request: Request }) {
  const upstream = new Headers();
  try {
    const feed = await apiGet<XTimelineFeed>("/api/x-timeline", {
      signal: request.signal,
      responseHeaders: upstream,
    });
    return cachedPage(120, { feed, unavailable: false }, upstream);
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    return cachedPage(60, { feed: null, unavailable: true }, upstream);
  }
}

export function meta() {
  return pageMeta({
    title: "X 时间线",
    description: "关注的公开动态：抓回来的帖子带图片、要点和原帖链接。",
    path: "/x",
  });
}

/** A post longer than this is a long one: X's own limit for a single post. */
const LONG_POST = 280;

function pictures(post: XPost): XMedia[] {
  return (post.media ?? []).filter((item) => (item?.kind ?? "image") === "image" && Boolean(item?.url));
}

function hasPicture(post: XPost): boolean {
  return pictures(post).length > 0;
}

function isLong(post: XPost): boolean {
  return (post.text ?? "").length > LONG_POST;
}

/** How the posts are looked at: everything, only the ones with pictures, only the long ones. */
type Filter = "all" | "media" | "long";

/** The numbers that say how loud a post was. */
function heatOf(post: XPost): string | null {
  const heat = post.heat;
  if (!heat) return null;
  const parts: string[] = [];
  if (typeof heat.favorite === "number") parts.push("赞 " + heat.favorite);
  if (typeof heat.retweet === "number") parts.push("转 " + heat.retweet);
  if (typeof heat.views === "number") parts.push("看 " + heat.views);
  return parts.length ? parts.join(" · ") : null;
}

/** One post: who said it, when, the words, the pictures and the original. */
function PostCard({ post }: { post: XPost }) {
  const body = (post.text ?? "").trim();
  const headline = (post.title ?? "").trim();
  const images = pictures(post);
  const others = (post.media ?? []).filter((item) => (item?.kind ?? "image") !== "image" && Boolean(item?.url));
  const heat = heatOf(post);
  const who = post.authorName || (post.handle ? "@" + post.handle : "X");
  return (
    <article className="rounded-card border border-line bg-surface p-4">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-4">
        <span className="text-[13px] font-medium text-ink">{who}</span>
        {post.handle && <span>@{post.handle}</span>}
        {post.publishedAt && (
          <time dateTime={post.publishedAt} suppressHydrationWarning>
            {relativeTime(post.publishedAt)}
          </time>
        )}
        {post.lang && <span className="text-[11px] uppercase">{post.lang}</span>}
        {heat && <span className="num">{heat}</span>}
        {post.url && (
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto text-[12px] text-accent hover:underline"
          >
            看原帖
          </a>
        )}
      </header>

      {headline && headline !== body && (
        <p className="mt-2 text-[14px] font-medium leading-relaxed text-ink">{headline}</p>
      )}
      {body && <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2">{body}</p>}

      {images.length > 0 && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {images.map((item, index) => (
            <a key={String(item.url) + index} href={String(item.url)} target="_blank" rel="noreferrer noopener">
              <img
                src={String(item.url)}
                alt={headline || body.slice(0, 60) || "帖子图片"}
                loading="lazy"
                decoding="async"
                className="aspect-[16/9] w-full rounded-card object-cover"
              />
            </a>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {others.map((item, index) => (
            <a
              key={String(item.url) + index}
              href={String(item.url)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[12px] text-accent hover:underline"
            >
              {item.kind === "video" ? "看视频" : "看附件"}
            </a>
          ))}
        </div>
      )}

      {post.excerpt && post.excerpt.trim() && post.excerpt.trim() !== body && (
        <div className="mt-2 rounded-card bg-bg-sunk p-3">
          <div className="text-[11.5px] font-medium text-ink-4">摘要</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{post.excerpt}</p>
        </div>
      )}

      {post.quoted && (
        <div className="mt-2 rounded-card border border-line-soft p-3">
          <div className="text-[11.5px] text-ink-4">
            引用 {post.quoted.authorName || (post.quoted.handle ? "@" + post.quoted.handle : "他人")}
          </div>
          {post.quoted.text && (
            <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-3">{post.quoted.text}</p>
          )}
          {post.quoted.url && (
            <a
              href={post.quoted.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-block text-[12px] text-accent hover:underline"
            >
              看被引用的帖子
            </a>
          )}
        </div>
      )}
    </article>
  );
}

export default function XTimelinePage() {
  const { feed, unavailable } = useLoaderData<typeof loader>();
  const [filter, setFilter] = useState<Filter>("all");

  const posts = useMemo(() => feed?.posts ?? [], [feed]);
  const handle = feed?.handle ?? null;
  const source = feed?.source ?? null;

  const kept = useMemo(() => {
    if (filter === "media") return posts.filter(hasPicture);
    if (filter === "long") return posts.filter(isLong);
    return posts;
  }, [posts, filter]);

  const pill = (active: boolean) =>
    "rounded-full px-3 py-1 text-[12.5px] transition-colors " +
    (active ? "bg-accent text-accent-contrast" : "border border-line text-ink-3 hover:text-ink");

  return (
    <div className="pb-10">
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">X 时间线</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          关注的公开动态在这里：抓回来的帖子带图片、摘要和原帖链接。
        </p>
        {feed && (
          <p className="mt-1.5 text-[12.5px] text-ink-4">
            {handle ? "@" + handle + " · " : ""}
            {feed.mode === "cookie" ? "cookie 模式" : feed.mode ? feed.mode + " 模式" : "模式未知"}
            {source?.name ? " · " + source.name : ""}
            {source && !source.enabled ? " · 已暂停" : ""}
          </p>
        )}
      </header>

      {feed && !feed.hasKey && (
        <p className="mt-2 rounded-card border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-3">
          没有配置采集凭证，帖子可能抓不全；到后台的「X 时间线」页面看看怎么配。
        </p>
      )}

      {posts.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilter("all")}
            aria-current={filter === "all" ? "true" : undefined}
            className={pill(filter === "all")}
          >
            全部
          </button>
          <button
            type="button"
            onClick={() => setFilter("media")}
            aria-current={filter === "media" ? "true" : undefined}
            className={pill(filter === "media")}
          >
            带图
          </button>
          <button
            type="button"
            onClick={() => setFilter("long")}
            aria-current={filter === "long" ? "true" : undefined}
            className={pill(filter === "long")}
          >
            长贴
          </button>
          <span className="num text-[12px] text-ink-4">共 {posts.length} 条</span>
        </div>
      )}

      {!feed ? (
        <EmptyState title="时间线暂时读不到">
          {unavailable ? "站点还没有连上 X 接口，过一会儿再来。" : "还没有内容。"}
        </EmptyState>
      ) : feed.configured === false ? (
        <EmptyState title="还没有配置 X 账号">
          在后台的「X 时间线」页面里指定要看的账号，采集任务会按周期把动态带回来。
        </EmptyState>
      ) : posts.length === 0 ? (
        <EmptyState title="还没有采集到帖子">
          到后台的「X 时间线」页面点一次刷新，采集任务也会按周期继续跑。
        </EmptyState>
      ) : kept.length === 0 ? (
        <EmptyState title="没有符合条件的帖子">换一个筛选条件看看。</EmptyState>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {kept.map((post, index) => (
            <PostCard key={post.id ?? String(index)} post={post} />
          ))}
        </div>
      )}

      <p className="mt-8 text-[12px] leading-relaxed text-ink-4">
        帖子来自公开接口，版权归原作者；引用请回到原帖。采集按周期运行，也可以在后台手动刷新。
      </p>
    </div>
  );
}
