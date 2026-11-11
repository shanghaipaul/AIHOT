// The 运行配置 card: one group per section, one row per entry, and a save button that writes the
// value back to /api/admin/config. The effective value and where it comes from are shown next to
// the control, so an admin can tell an override from an environment variable from a code default.
import { useEffect, useState } from "react";
import { useAdminAction } from "../action";
import { Badge, Button, Card, Empty, Input, Select } from "../ui";
import type { AdminConfigEntry, AdminConfigSource, AdminConfigValue, AdminConfigWriteResult } from "./config-types";

const SOURCE_LABEL: Record<AdminConfigSource, string> = {
  admin: "后台设置",
  env: "环境变量",
  default: "默认值",
};

const SOURCE_TONE = { admin: "accent", env: "info", default: "muted" } as const;

const REASON = "后台修改运行配置";
const CLEAR_REASON = "后台清除运行配置";

/** The switch the admin styles have no component for: a small pill in the same tokens. */
function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 ring-1 transition-colors ${on ? "bg-accent ring-accent/40" : "bg-bg-sunk ring-line-strong"}`}
    >
      <span className={`size-5 rounded-full bg-surface ring-1 ring-line/30 transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

/** The value an entry starts from: the effective one, or the default when nothing is set. */
function initialText(entry: AdminConfigEntry): string {
  if (entry.secret) return "";
  const value = entry.value === null || entry.value === undefined ? entry.default : entry.value;
  return value === null || value === undefined ? "" : String(value);
}

function ConfigRow({ entry }: { entry: AdminConfigEntry }) {
  const { run, pending } = useAdminAction();
  const [draft, setDraft] = useState(() => initialText(entry));
  const [on, setOn] = useState(() => entry.value === true || entry.value === "true");
  const [error, setError] = useState<string | null>(null);
  const saveLabel = `config-${entry.key}`;
  const clearLabel = `config-clear-${entry.key}`;

  // The page reloads the entries after a save; the row follows the value it is given.
  useEffect(() => {
    setDraft(initialText(entry));
    setOn(entry.value === true || entry.value === "true");
    setError(null);
  }, [entry.value, entry.default, entry.secret, entry.key]);

  const save = async () => {
    setError(null);
    let value: AdminConfigValue;
    if (entry.type === "bool") {
      value = on;
    } else if (entry.type === "int") {
      const parsed = Number(draft.trim());
      if (draft.trim() === "" || !Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        setError("请输入一个整数");
        return;
      }
      value = parsed;
    } else if (entry.type === "enum") {
      if (entry.options?.length && !entry.options.includes(draft)) {
        setError(`只能选择 ${entry.options.join(" / ")}`);
        return;
      }
      value = draft;
    } else {
      value = draft;
    }
    if (entry.secret && draft === "") {
      setError("请输入新的值，或点「清除」去掉已设置的值");
      return;
    }
    const res = await run<AdminConfigWriteResult>(
      "POST",
      `/api/admin/config/${encodeURIComponent(entry.key)}`,
      { value, reason: REASON },
      { label: saveLabel, success: `${entry.label} 已保存` },
    );
    if (res === null) {
      setError("保存失败，后端的说明在右下角提示里");
      return;
    }
    if (res.error) {
      setError(res.error);
      return;
    }
    if (entry.secret) setDraft("");
  };

  const clear = async () => {
    setError(null);
    const res = await run<AdminConfigWriteResult>(
      "DELETE",
      `/api/admin/config/${encodeURIComponent(entry.key)}`,
      { reason: CLEAR_REASON },
      { label: clearLabel, success: `${entry.label} 已清除` },
    );
    if (res === null) {
      setError("清除失败，后端的说明在右下角提示里");
      return;
    }
    if (res.error) {
      setError(res.error);
      return;
    }
    setDraft("");
  };

  const control = () => {
    if (entry.type === "bool") return <Switch on={on} onToggle={() => setOn(!on)} label={entry.label} />;
    if (entry.type === "int") {
      return (
        <Input
          type="number"
          className="!w-36 !py-1.5 text-right"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      );
    }
    if (entry.type === "enum" && entry.options?.length) {
      return (
        <Select className="!w-48 !py-1.5" value={draft} onChange={(e) => setDraft(e.target.value)}>
          {!entry.options.includes(draft) && <option value="">未设置</option>}
          {entry.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    }
    if (entry.secret) {
      return (
        <div className="flex items-center gap-2">
          <Badge tone={entry.hasValue ? "ok" : "muted"}>{entry.hasValue ? "已设置" : "未设置"}</Badge>
          <Input
            type="password"
            autoComplete="new-password"
            className="!w-56 !py-1.5"
            placeholder="输入新的值"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button size="sm" tone="danger" disabled={!entry.hasValue} busy={pending === clearLabel} onClick={clear}>
            清除
          </Button>
        </div>
      );
    }
    return (
      <Input
        className="!w-64 !py-1.5"
        placeholder="请输入"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
    );
  };

  const defaultHint =
    !entry.secret && entry.source !== "default" && entry.default !== null && entry.default !== undefined
      ? `默认值 ${String(entry.default)}`
      : null;

  return (
    <div className="border-b border-line/70 px-3 py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-medium text-ink">{entry.label}</span>
            <Badge tone={SOURCE_TONE[entry.source] ?? "muted"}>{SOURCE_LABEL[entry.source] ?? entry.source}</Badge>
            {entry.restart && <Badge tone="warn">需重启生效</Badge>}
            {entry.danger && <Badge tone="bad">高风险</Badge>}
          </div>
          <div className="mt-0.5 break-words text-[12px] text-ink-4">{entry.description ?? entry.key}</div>
          {defaultHint && <div className="mt-0.5 text-[11.5px] text-ink-4">{defaultHint}</div>}
        </div>
        <div className="flex items-center gap-2">
          {control()}
          <Button
            size="sm"
            tone={entry.danger ? "danger" : "primary"}
            busy={pending === saveLabel}
            disabled={entry.secret && draft === ""}
            onClick={save}
          >
            保存
          </Button>
        </div>
      </div>
      {error && <div className="mt-2 text-[12px] text-hot">{error}</div>}
    </div>
  );
}

/** The entries in the order the api sent them, grouped by their group. */
function grouped(entries: AdminConfigEntry[]): Array<[string, AdminConfigEntry[]]> {
  const groups = new Map<string, AdminConfigEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.group);
    if (list) list.push(entry);
    else groups.set(entry.group, [entry]);
  }
  return [...groups.entries()];
}

export function RuntimeConfigCard({ entries, error }: { entries: AdminConfigEntry[]; error?: string | null }) {
  const groups = grouped(entries);
  return (
    <Card title="运行配置" className="mb-5" right={<span>共 {entries.length} 项</span>}>
      <div className="space-y-5">
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          生效优先级：后台设置 &gt; 环境变量 &gt; 默认值。保存后立即生效；标记为密钥的项不会回显，只能重新写入或清除。
        </p>
        {error && (
          <div className="rounded-control bg-hot-soft px-3 py-2 text-[12.5px] text-hot ring-1 ring-hot/25">
            读取运行配置失败：{error}
          </div>
        )}
        {!error && !groups.length && <Empty>后端还没有发布运行配置项</Empty>}
        {groups.map(([group, items]) => (
          <section key={group}>
            <h3 className="mb-2 text-[12.5px] font-medium text-ink-3">{group}</h3>
            <div className="overflow-hidden rounded-control ring-1 ring-line">
              {items.map((entry) => (
                <ConfigRow key={entry.key} entry={entry} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Card>
  );
}
