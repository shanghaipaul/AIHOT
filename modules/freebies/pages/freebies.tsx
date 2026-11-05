// The free-tier list: what is given away for free, in one place. The page shows the hand-written
// list first (the free quotas worth knowing about) and the collected free-for.dev list below it,
// grouped by category. A reader can search across both and narrow by category.
import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { Badge } from "@aihot/web/components/ui/Badge";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { apiGet, cachedPage, pageHeaders } from "@aihot/web/lib/api.server";
import { relativeTime } from "@aihot/web/lib/format";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import type { FreebieItem, FreebiesSnapshot } from "../backend/types.ts";

export { pageHeaders as headers };
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  const upstream = new Headers();
  try {
    const response = await apiGet<FreebiesSnapshot>("/api/freebies", {
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
    title: "薅羊毛 · 免费额度清单",
    description: "免费 token、免费层与免费额度清单：模型 API、编程助手、搜索抓取与部署数据库，全部指向官网说明页。",
    path: "/freebies",
  });
}

const FIELD =
  "w-full rounded-card bg-well text-ink outline-none ring-1 ring-inset ring-line-soft transition-[background-color,box-shadow] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent";

/** How many categories of the collected list are shown before the reader asks for more. */
const CATEGORY_PAGE = 12;

function haystack(item: FreebieItem): string {
  return [item.name, item.vendor, item.category, item.quota, item.detail].filter(Boolean).join(" ").toLowerCase();
}

/** One entry of the hand-written list. */
function CuratedCard({ item }: { item: FreebieItem }) {
  return (
    <li className="flex flex-col rounded-card border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[14px] font-semibold text-ink underline-offset-2 hover:text-accent hover:underline"
        >
          {item.name}
        </a>
        {item.vendor && <Badge tone="neutral">{item.vendor}</Badge>}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{item.quota}</p>
      {item.detail && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-4">{item.detail}</p>}
    </li>
  );
}

/** One entry of the collected list: a link and the vendor's own wording. */
function DevRow({ item }: { item: FreebieItem }) {
  return (
    <li className="py-2">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer noopener"
        className="text-[13.5px] font-medium text-ink underline-offset-2 hover:text-accent hover:underline"
      >
        {item.name}
      </a>
      {item.detail && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-4">{item.detail}</p>}
    </li>
  );
}

export default function FreebiesPage() {
  const { snapshot, unavailable } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [shownCategories, setShownCategories] = useState(CATEGORY_PAGE);

  const curated = snapshot?.curated ?? [];
  const dev = snapshot?.dev ?? [];

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const item of curated) names.add(item.category);
    for (const item of dev) names.add(item.category);
    return [...names];
  }, [curated, dev]);

  const needle = query.trim().toLowerCase();
  const keep = (item: FreebieItem): boolean => (!needle || haystack(item).includes(needle)) && (!category || item.category === category);

  const curatedShown = curated.filter(keep);
  const devShown = dev.filter(keep);

  const devByCategory = useMemo(() => {
    const groups = new Map<string, FreebieItem[]>();
    for (const item of devShown) {
      const list = groups.get(item.category);
      if (list) list.push(item);
      else groups.set(item.category, [item]);
    }
    return [...groups.entries()];
  }, [devShown]);

  const title = (
    <header className="pb-2 pt-3 lg:pt-1">
      <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">
        薅羊毛
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
        免费 token、免费层与免费额度清单：上面是人工挑的重点，下面是 free-for.dev 的全量列表（按分类整理）。
        每一条都指向官网的说明页——额度以官网为准，厂商随时会调整。
      </p>
    </header>
  );

  return (
    <div className="pb-10">
      {title}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索服务名、厂商或额度，比如 Groq、Cursor、credits"
          className={`${FIELD} h-10 px-3 text-[13.5px] sm:w-80`}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCategory("")}
            className={
              "rounded-full px-3 py-1 text-[12.5px] transition-colors " +
              (category === "" ? "bg-ink text-surface" : "border border-line text-ink-3 hover:text-ink")
            }
          >
            全部
          </button>
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setCategory(name)}
              className={
                "rounded-full px-3 py-1 text-[12.5px] transition-colors " +
                (category === name ? "bg-ink text-surface" : "border border-line text-ink-3 hover:text-ink")
              }
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {!snapshot ? (
        <EmptyState title="清单暂时读不到">{unavailable ? "站点还没有连上清单接口，过一会儿再来。" : "还没有内容。"}</EmptyState>
      ) : (
        <>
          <section className="mt-6">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h2 className="text-[16px] font-semibold text-ink">精选免费额度</h2>
              <span className="num text-[12px] text-ink-4">{curatedShown.length} 条</span>
            </div>
            {curatedShown.length === 0 ? (
              <p className="mt-3 text-[13px] text-ink-4">没有匹配的条目，换个关键词试试。</p>
            ) : (
              <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {curatedShown.map((item) => (
                  <CuratedCard key={item.name + item.url} item={item} />
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h2 className="text-[16px] font-semibold text-ink">free-for.dev 全量清单</h2>
              <span className="num text-[12px] text-ink-4">{devShown.length} 条</span>
              {snapshot.devSource.stars !== null && (
                <span className="num text-[12px] text-ink-4">{snapshot.devSource.repo} · {snapshot.devSource.stars.toLocaleString("zh-CN")} 星标</span>
              )}
              {snapshot.devFetchedAt && <span className="text-[12px] text-ink-4">更新于 {relativeTime(snapshot.devFetchedAt)}</span>}
            </div>
            {devByCategory.length === 0 ? (
              <p className="mt-3 text-[13px] text-ink-4">清单还没有抓到，过一会儿再来。</p>
            ) : (
              <>
                <div className="mt-3 space-y-4">
                  {devByCategory.slice(0, shownCategories).map(([name, items]) => (
                    <div key={name}>
                      <h3 className="text-[13px] font-semibold text-ink-2">
                        {name} <span className="num ml-1 font-normal text-ink-4">{items.length}</span>
                      </h3>
                      <ul className="mt-1 divide-y divide-line-soft border-b border-line-soft">
                        {items.map((item) => (
                          <DevRow key={item.name + item.url} item={item} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                {shownCategories < devByCategory.length && (
                  <div className="mt-5 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setShownCategories(shownCategories + CATEGORY_PAGE)}
                      className="rounded-full border border-line px-4 py-1.5 text-[12.5px] text-ink-3 transition-colors hover:text-ink"
                    >
                      显示更多分类（还有 {devByCategory.length - shownCategories} 个）
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
