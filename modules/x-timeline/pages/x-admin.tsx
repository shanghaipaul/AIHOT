// The admin page for the x-timeline module: it configures the account to watch, the way that account
// is read (a paid api, a login cookie or the embedded syndication timeline), the proxy that reaches
// x.com and how often the collector runs. It also shows how the last collection went. The buttons
// talk to the api with the admin session and read the api's own Chinese error message back, so the
// page says why a command did not work instead of showing a bare status code.
import { useState } from "react";
import { useLoaderData, useRevalidator, useRouteLoaderData } from "react-router";
import {
  AdminPage,
  Badge,
  Button,
  ButtonLink,
  Card,
  DataTable,
  Empty,
  Field,
  Input,
  KV,
  Stat,
  Time,
  healthTone,
} from "@aihot/web/features/admin/ui";
import type { Column } from "@aihot/web/features/admin/ui";
import { adminGet } from "@aihot/web/lib/admin.server";
import { asMode, modeHint, modeLabel } from "./x-timeline";
import type { XMode, XPost, XTimelineFeed } from "./x-timeline";

export async function loader({ request }: { request: Request }) {
  try {
    const feed = await adminGet<XTimelineFeed>(request, "/api/x-timeline");
    return { feed, error: null as string | null };
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status === 302) throw error;
    return { feed: null, error: "读不到 X 接口的数据：模块可能还没上线，或者采集端没起来。" };
  }
}

/** The three ways the collector can read X, with what each one needs. */
const MODES: Array<{ value: XMode; title: string; hint: string }> = [
  { value: "syndication", title: "嵌入时间线（syndication）", hint: "免 API key，走代理读公开时间线，推荐" },
  { value: "socialdata", title: "SocialData 付费 API", hint: "需要 SOCIALDATA_API_KEY" },
  { value: "cookie", title: "登录 Cookie", hint: "采集器还没接入" },
];

/** One line of the recent posts table. */
type Row = { post: XPost; key: string };

/** A number the api may or may not have sent. */
function count(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "—";
}

export default function XAdminPage() {
  const { feed, error } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const layout = useRouteLoaderData("admin-layout") as { me?: { csrf?: string } } | undefined;
  const csrf = layout?.me?.csrf;

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const source = feed?.source ?? null;
  const posts = feed?.posts ?? [];
  const mode = asMode(feed?.mode);
  const last = feed?.lastCollection ?? null;

  const [draftMode, setDraftMode] = useState<XMode>(mode ?? "syndication");
  const [handle, setHandle] = useState(feed?.handle ?? "");
  const [proxy, setProxy] = useState("");
  const [interval, setInterval] = useState(String(source?.intervalMinutes ?? 120));
  const [replies, setReplies] = useState(false);

  /** Sends one command and puts the answer where the reader sees it. */
  async function command(label: string, path: string, body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(label);
    setNote(null);
    setProblem(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) {
        setProblem(typeof data?.error === "string" && data.error ? data.error : "请求失败（" + response.status + "）");
        return null;
      }
      if (data && data.ok === false) {
        setProblem(typeof data.error === "string" && data.error ? data.error : "接口没有接受这个命令。");
        return null;
      }
      revalidator.revalidate();
      return data ?? {};
    } catch {
      setProblem("请求没有发出去，检查网络后再试一次。");
      return null;
    } finally {
      setBusy(null);
    }
  }

  /** Writes the form into the site settings and into the collection source. */
  async function save() {
    const minutes = Math.max(1, Math.min(1440, Number(interval) || 120));
    const data = await command("save", "/api/x-timeline/source", {
      action: source ? "update" : "create",
      handle: handle.trim(),
      mode: draftMode,
      // An empty proxy means "keep the stored one": the api ignores empty values.
      proxy: proxy.trim(),
      includeReplies: replies,
      intervalMinutes: minutes,
    });
    if (!data) return;
    setNote(
      source
        ? "配置已保存，采集端会在下一次调度时生效。"
        : "采集源已创建，采集端会在下一次调度时生效。",
    );
    setProxy("");
  }

  /** Runs the collector once and reports what it found. */
  async function refresh() {
    const data = await command("refresh", "/api/x-timeline/refresh", {});
    if (!data) return;
    const status = typeof data.status === "number" ? data.status : null;
    if (status === 429) {
      setProblem("X 限流了（HTTP 429）：等一会儿再点刷新，或者把采集间隔调大（建议不低于 60 分钟）。");
      return;
    }
    if (typeof data.error === "string" && data.error.trim()) {
      setProblem(data.error.trim());
      return;
    }
    const parts: string[] = [];
    if (typeof data.found === "number") parts.push("找到 " + data.found + " 条");
    if (typeof data.created === "number") parts.push("新增 " + data.created + " 条");
    if (typeof data.skipped === "number") parts.push("跳过 " + data.skipped + " 条");
    if (data.jobId) parts.push("任务已排队");
    setNote("刷新完成：" + (parts.length ? parts.join("，") : "没有新的帖子") + "。");
  }

  /** Stops or starts the collector. */
  async function toggleSource(enabled: boolean) {
    const data = await command(enabled ? "resume" : "pause", "/api/x-timeline/source", {
      action: enabled ? "resume" : "pause",
    });
    if (!data) return;
    setNote(enabled ? "已恢复采集。" : "已暂停采集。");
  }

  /** Puts the form back to what the api says. */
  function reset() {
    setDraftMode(mode ?? "syndication");
    setHandle(feed?.handle ?? "");
    setProxy("");
    setInterval(String(source?.intervalMinutes ?? 120));
    setReplies(false);
  }

  const recent: Row[] = posts
    .slice(0, 20)
    .map((post, index) => ({ post, key: post.id ?? post.url ?? String(index) }));

  const columns: Column<Row>[] = [
    {
      key: "time",
      label: "时间",
      render: (row) => <Time at={row.post.publishedAt ?? null} />,
    },
    {
      key: "content",
      label: "内容",
      render: (row) => (
        <span className="line-clamp-2">
          {row.post.excerpt || row.post.text || row.post.title || "（空）"}
        </span>
      ),
    },
    {
      key: "link",
      label: "原帖",
      align: "right",
      render: (row) =>
        row.post.url ? (
          <a
            href={row.post.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent hover:underline"
          >
            打开
          </a>
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
  ];

  return (
    <AdminPage
      title="X 时间线"
      subtitle="配置要抓的 X 账号、采集方式和出口代理；看采集源的状态，启停它，或者手动刷新一轮。"
      actions={
        <>
          <ButtonLink to="/admin/settings" tone="ghost" size="sm">
            去配置中心
          </ButtonLink>
          <Button tone="primary" size="sm" busy={busy === "refresh"} onClick={() => void refresh()}>
            立即刷新
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="账号"
          value={feed?.handle ? "@" + feed.handle : "未配置"}
          hint={modeLabel(mode)}
        />
        <Stat
          label="采集方式"
          value={modeLabel(mode)}
          hint={modeHint(mode)}
          tone={mode === "syndication" ? "ok" : undefined}
        />
        <Stat
          label="出口代理"
          value={feed?.hasProxy ? "已配置" : "未配置"}
          hint={feed?.hasProxy ? "留空保存不会清掉它" : "syndication 靠它连上 x.com"}
          tone={feed?.hasProxy ? "ok" : "warn"}
        />
        <Stat
          label="SocialData key"
          value={feed?.hasKey ? "已配置" : "没有"}
          hint={feed?.hasKey ? "可以用付费接口" : "只有 socialdata 模式需要"}
          tone={feed?.hasKey ? "ok" : "warn"}
        />
      </div>

      {error && (
        <Card className="mt-3">
          <p className="text-[13px] text-ink-3">{error}</p>
        </Card>
      )}

      {(note || problem) && (
        <Card className="mt-3">
          {note && <p className="text-[12.5px] leading-relaxed text-ink-3">{note}</p>}
          {problem && <p className="mt-1 text-[12.5px] leading-relaxed text-hot">{problem}</p>}
        </Card>
      )}

      <Card title="采集配置" className="mt-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="X 用户名" hint="不带 @，例如 openai；syndication 只能读这个账号的公开时间线">
            <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="openai" />
          </Field>
          <Field
            label="采集间隔（分钟）"
            hint={
              draftMode === "syndication"
                ? "X 对同一个出口 IP 会限流（HTTP 429），间隔建议不低于 60 分钟。"
                : "默认 120 分钟"
            }
          >
            <Input
              type="number"
              min={1}
              max={1440}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <div className="mb-1 text-[12.5px] font-medium text-ink-2">采集方式</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((item) => (
              <label
                key={item.value}
                className={
                  "cursor-pointer rounded-card p-3 ring-1 transition-colors " +
                  (draftMode === item.value
                    ? "bg-accent-soft ring-accent"
                    : "ring-line-strong hover:bg-bg-sunk")
                }
              >
                <input
                  type="radio"
                  name="x-mode"
                  className="sr-only"
                  checked={draftMode === item.value}
                  onChange={() => setDraftMode(item.value)}
                />
                <span className="block text-[13px] font-medium text-ink">{item.title}</span>
                <span className="mt-1 block text-[12px] text-ink-4">{item.hint}</span>
              </label>
            ))}
          </div>
        </div>

        {draftMode === "syndication" && (
          <div className="mt-4">
            <Field
              label="出口代理"
              hint="用于连接 x.com，直连不通时必须填；留空保存不会清掉已经存好的代理。"
            >
              <div className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  value={proxy}
                  onChange={(e) => setProxy(e.target.value)}
                  placeholder="http://user:pass@host:port"
                />
                {feed?.hasProxy && <Badge tone="ok">已配置</Badge>}
              </div>
            </Field>
            <p className="mt-1 text-[12px] text-ink-4">
              代理地址由后端加密保存，页面只显示「已配置」，不回显其中的账号和密码。
            </p>
          </div>
        )}

        <label className="mt-4 inline-flex items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={replies}
            onChange={(e) => setReplies(e.target.checked)}
          />
          包含回复（默认关闭，打开后该账号的回复也会进时间线）
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button tone="primary" busy={busy === "save"} onClick={() => void save()}>
            保存配置
          </Button>
          <Button tone="ghost" onClick={reset}>
            还原
          </Button>
          <span className="text-[12px] text-ink-4">
            {source ? "已有采集源，保存走 update" : "还没有采集源，保存会创建"}
          </span>
        </div>
      </Card>

      <Card title="采集源状态" className="mt-3">
        <KV
          items={[
            ["源名称", source?.name ?? "还没有源"],
            ["源 ID", source?.id ?? "—"],
            ["源类型", source?.kind ?? "—"],
            [
              "状态",
              source ? (
                source.enabled ? (
                  <Badge tone="ok">启用中</Badge>
                ) : (
                  <Badge tone="muted">已暂停</Badge>
                )
              ) : (
                "—"
              ),
            ],
            ["健康", source?.health ? <Badge tone={healthTone(source.health)}>{source.health}</Badge> : "—"],
            ["采集间隔", source?.intervalMinutes ? source.intervalMinutes + " 分钟" : "—"],
            ["最近抓取", <Time at={source?.lastFetchAt ?? null} />],
            ["最近成功", <Time at={source?.lastOkAt ?? null} />],
            ["上次错误", source?.lastError ?? "—"],
            ["SocialData key", feed?.hasKey ? <Badge tone="ok">已配置</Badge> : <Badge tone="warn">没有</Badge>],
            ["出口代理", feed?.hasProxy ? <Badge tone="ok">已配置</Badge> : <Badge tone="warn">没有</Badge>],
            ["帖子数", String(posts.length)],
          ]}
        />
      </Card>

      <Card title="最近一次采集" className="mt-3">
        <KV
          items={[
            [
              "状态",
              typeof last?.status === "number" ? (
                <Badge tone={last.status === 429 ? "warn" : last.status >= 400 ? "bad" : "ok"}>
                  HTTP {last.status}
                </Badge>
              ) : (
                "—"
              ),
            ],
            ["找到", count(last?.found)],
            ["新增", count(last?.created)],
            ["跳过", count(last?.skipped)],
            ["时间", <Time at={last?.at ?? null} />],
            ["错误", last?.error ?? "—"],
          ]}
        />
        {last?.status === 429 && (
          <p className="mt-2 rounded-card bg-amber/10 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-amber/25">
            X 限流了（HTTP 429）：等一会儿再点刷新，或者把采集间隔调大（syndication 建议不低于 60 分钟）。
          </p>
        )}
      </Card>

      <Card title="操作" className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            tone="primary"
            size="sm"
            busy={busy === "refresh"}
            onClick={() => void refresh()}
          >
            立即刷新
          </Button>
          <Button
            tone="secondary"
            size="sm"
            busy={busy === "pause"}
            disabled={!source || !source.enabled}
            onClick={() => void toggleSource(false)}
          >
            暂停采集
          </Button>
          <Button
            tone="secondary"
            size="sm"
            busy={busy === "resume"}
            disabled={!source || source.enabled}
            onClick={() => void toggleSource(true)}
          >
            恢复采集
          </Button>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-4">
          syndication 模式下「立即刷新」会直接跑一次采集并返回条数；socialdata 模式走采集引擎的强制抓取。
          代理、账号与采集方式保存后由采集端在下一个周期使用。
        </p>
      </Card>

      <Card title="最近的帖子" className="mt-3" scrollable>
        {posts.length === 0 ? (
          <Empty>还没有抓到帖子，先确认账号、采集方式和代理都配好了。</Empty>
        ) : (
          <DataTable<Row> rows={recent} columns={columns} rowKey={(row) => row.key} empty="还没有帖子" />
        )}
      </Card>
    </AdminPage>
  );
}
