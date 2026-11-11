// The admin page for the x-timeline module: it shows which account the module watches, how healthy the
// collector is, and the buttons that create, pause, resume or refresh it. The buttons talk to the api
// with the admin session and read the api's own Chinese error message back, so the page says why a
// command did not work instead of showing a bare status code.
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
  KV,
  Stat,
  Time,
  healthTone,
} from "@aihot/web/features/admin/ui";
import type { Column } from "@aihot/web/features/admin/ui";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { XPost, XTimelineFeed } from "./x-timeline";

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

/** One line of the recent posts table. */
type Row = { post: XPost; key: string };

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

  /** Sends one command and puts the answer where the reader sees it. */
  async function command(label: string, path: string, body: unknown, okText: string) {
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
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok) {
        setProblem(data?.error ?? "请求失败（" + response.status + "）");
        return;
      }
      if (data && data.ok === false) {
        setProblem(data.error ?? "接口没有接受这个命令。");
        return;
      }
      setNote(okText);
      revalidator.revalidate();
    } catch {
      setProblem("请求没有发出去，检查网络后再试一次。");
    } finally {
      setBusy(null);
    }
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
      subtitle="管理被抓取的 X 账号：看源的状态，启停它，或者手动刷新一轮。"
      actions={
        <>
          <ButtonLink to="/admin/settings" tone="ghost" size="sm">
            去配置账号
          </ButtonLink>
          <Button
            tone="primary"
            size="sm"
            busy={busy === "refresh"}
            onClick={() =>
              void command("refresh", "/api/x-timeline/refresh", {}, "已经请求刷新一轮，抓到的帖子会回到下面的列表里。")
            }
          >
            手动刷新
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="账号"
          value={feed?.handle ? "@" + feed.handle : "未配置"}
          hint={feed?.mode === "cookie" ? "cookie 模式" : feed?.mode ? feed.mode + " 模式" : "模式未知"}
        />
        <Stat
          label="采集源"
          value={source?.name ?? "还没有源"}
          hint={source ? (source.enabled ? "启用中" : "已暂停") : "先创建再更新"}
          tone={source && !source.enabled ? "warn" : undefined}
        />
        <Stat label="帖子数" value={String(posts.length)} hint="接口返回的条数" />
        <Stat
          label="凭证"
          value={feed?.hasKey ? "已配置" : "没有"}
          hint={feed?.hasKey ? "可以采集" : "先在配置页补上"}
          tone={feed?.hasKey ? "ok" : "warn"}
        />
      </div>

      {error && (
        <Card className="mt-3">
          <p className="text-[13px] text-ink-3">{error}</p>
        </Card>
      )}

      <Card title="账号与源" className="mt-3">
        <KV
          items={[
            ["账号", feed?.handle ? "@" + feed.handle : "未配置"],
            ["采集模式", feed?.mode === "cookie" ? "cookie（登录态）" : feed?.mode ?? "—"],
            ["凭证", feed?.hasKey ? <Badge tone="ok">已配置</Badge> : <Badge tone="warn">没有凭证</Badge>],
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
            ["搜索词", source?.query || "—"],
            ["最近抓取", <Time at={source?.lastFetchAt ?? null} />],
            ["最近成功", <Time at={source?.lastOkAt ?? null} />],
            ["上次错误", source?.lastError ?? "—"],
          ]}
        />
      </Card>

      <Card title="操作" className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          {source ? (
            <Button
              tone="secondary"
              size="sm"
              busy={busy === "update"}
              onClick={() =>
                void command("update", "/api/x-timeline/source", { action: "update" }, "已提交「update」，采集端会在下一次调度时生效。")
              }
            >
              更新源
            </Button>
          ) : (
            <Button
              tone="primary"
              size="sm"
              busy={busy === "create"}
              onClick={() =>
                void command("create", "/api/x-timeline/source", { action: "create" }, "已提交「create」，采集端会在下一次调度时生效。")
              }
            >
              创建源
            </Button>
          )}
          <Button
            tone="secondary"
            size="sm"
            busy={busy === "pause"}
            disabled={!source || !source.enabled}
            onClick={() =>
              void command("pause", "/api/x-timeline/source", { action: "pause" }, "已提交「pause」，采集端会在下一次调度时生效。")
            }
          >
            暂停采集
          </Button>
          <Button
            tone="secondary"
            size="sm"
            busy={busy === "resume"}
            disabled={!source || source.enabled}
            onClick={() =>
              void command("resume", "/api/x-timeline/source", { action: "resume" }, "已提交「resume」，采集端会在下一次调度时生效。")
            }
          >
            恢复采集
          </Button>
        </div>
        {note && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{note}</p>}
        {problem && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{problem}</p>}
        <p className="mt-2 text-[12px] leading-relaxed text-ink-4">
          X 用户名、采集方式、cookie 与每日条数上限在「配置中心」里填；这里管的是采集源本身。
        </p>
      </Card>

      <Card title="最近的帖子" className="mt-3" scrollable>
        {posts.length === 0 ? (
          <Empty>还没有抓到帖子，先确认账号和凭证都配好了。</Empty>
        ) : (
          <DataTable<Row> rows={recent} columns={columns} rowKey={(row) => row.key} empty="还没有帖子" />
        )}
      </Card>
    </AdminPage>
  );
}
