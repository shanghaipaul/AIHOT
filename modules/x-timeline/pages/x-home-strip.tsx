// A short block on the home page: the newest posts of the X account the module watches. It shows on
// the home page only — every other page keeps its own shape — and it reads the api in the browser,
// so the server-rendered page stays empty and quick. The three empty states are told apart: an
// account nobody configured, X's rate limit, and an account with nothing to show.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { relativeTime } from "@aihot/web/lib/format";

/** One post, as far as this block needs it. */
export interface XHomePost {
  id?: string | null;
  url?: string | null;
  title?: string | null;
  text?: string | null;
  publishedAt?: string | null;
}

/** How the last collection went, as far as this block needs it. */
export interface XHomeCollection {
  status?: number | null;
}

/** The whole answer of GET /api/x-timeline, as far as this block needs it. */
export interface XHomeFeed {
  configured?: boolean;
  handle?: string | null;
  posts?: XHomePost[] | null;
  lastCollection?: XHomeCollection | null;
}

/** How many posts the block shows. */
const MAX_POSTS = 5;

/** The words of a post: its text, or its headline when there is no text. */
function bodyOf(post: XHomePost): string {
  const text = (post.text ?? "").trim();
  if (text) return text;
  return (post.title ?? "").trim();
}

/** One post: the words, when they were written, and the original. */
function StripPost({ post }: { post: XHomePost }) {
  const body = bodyOf(post);
  return (
    <li className="border-t border-line-soft pt-2 first:border-t-0 first:pt-0">
      {body && <p className="line-clamp-2 text-[13px] leading-relaxed text-ink-2">{body}</p>}
      <div className="mt-1 flex items-center gap-2 text-[11.5px] text-ink-4">
        {post.publishedAt && (
          <time dateTime={post.publishedAt} suppressHydrationWarning>
            {relativeTime(post.publishedAt)}
          </time>
        )}
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
      </div>
    </li>
  );
}

export default function XHomeStrip() {
  const location = useLocation();
  const [feed, setFeed] = useState<XHomeFeed | null>(null);
  const onHome = location.pathname === "/";

  useEffect(() => {
    // Only the home page asks for the timeline; the other pages pay nothing for it.
    if (!onHome) return;
    let alive = true;
    fetch("/api/x-timeline", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: XHomeFeed | null) => {
        if (alive && data) setFeed(data);
      })
      .catch(() => {
        // The api cannot be reached: the block stays empty and the page keeps working.
      });
    return () => {
      alive = false;
    };
  }, [onHome]);

  // Another page, or the server-rendered page before the browser has the posts: nothing to draw.
  if (!onHome || !feed) return null;

  const posts = (feed.posts ?? []).slice(0, MAX_POSTS);
  const notConfigured = feed.configured === false;
  const limited = feed.lastCollection?.status === 429;

  return (
    <section aria-label="我的 X 动态" className="mb-4 rounded-card border border-line bg-surface p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold leading-[1.4] text-ink">我的 X 动态</h2>
        <Link to="/x" className="text-[12.5px] text-accent hover:underline">
          查看全部 →
        </Link>
      </header>

      {posts.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {posts.map((post, index) => (
            <StripPost key={post.id ?? String(index)} post={post} />
          ))}
        </ul>
      ) : notConfigured ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
          还没配置 X 账号，
          <Link to="/admin/x" className="text-accent hover:underline">
            去后台设置
          </Link>
        </p>
      ) : limited ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
          X 限流中（HTTP 429），同一个出口 IP 请求太频繁，过一会儿再试
        </p>
      ) : (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">还没有抓到动态</p>
      )}
    </section>
  );
}
