// Runtime configuration: the values an operator changes in the admin, without editing .env and
// restarting. A value comes from the settings table (config.<key>) first, then the environment
// variable, then the default of the entry. The settings copy is cached in the process and
// refreshed every 30 seconds; an admin write refreshes it at once.
import { sql } from "./db.ts";
import { audit } from "./audit.ts";

export type ConfigValueType = "bool" | "int" | "string" | "enum";

export interface ConfigEntry {
  /** Dotted name, like "collect.enabled"; stored as the settings key "config.collect.enabled". */
  key: string;
  label: string;
  /** The section the entry is shown in. */
  group: string;
  type: ConfigValueType;
  /** The environment variable behind it; derived from the key when it is not given. */
  env?: string;
  /** The values an enum accepts. */
  options?: string[];
  default?: string | number | boolean;
  description?: string;
  /** The process has to be restarted for the change to take full effect. */
  restart?: boolean;
  /** A switch that changes what the site reaches out to; shown with a warning. */
  danger?: boolean;
  /** The value is never sent back to the browser. */
  secret?: boolean;
}

export interface ConfigEntryState extends ConfigEntry {
  value: string | number | boolean | null;
  /** Where the effective value comes from. */
  source: "admin" | "env" | "default";
  /** Whether a value is set at all (a secret never shows its value). */
  hasValue: boolean;
}

/** A wrong value or an unknown key: the admin api turns this into a 400 instead of a server error. */
export class ConfigError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const registry = new Map<string, ConfigEntry>();

/** The engine own switches; a module adds its own (ServerModule.settings). */
registerConfigEntries([
  { key: "collect.enabled", label: "采集", group: "采集", type: "bool", env: "COLLECT_ENABLED", default: false, description: "worker 是否抓取信源" },
  { key: "model.calls.enabled", label: "模型调用", group: "模型", type: "bool", env: "MODEL_CALLS_ENABLED", default: false, description: "关闭后所有模型调用都不发（打分、摘要、嵌入）" },
  { key: "push.feishu.enabled", label: "飞书内容推送", group: "推送", type: "bool", env: "FEISHU_CONTENT_PUSH_ENABLED", default: false },
  { key: "push.indexnow.enabled", label: "IndexNow 提交", group: "推送", type: "bool", env: "INDEXNOW_SUBMIT_ENABLED", default: false },
  { key: "fetch.allow_private_network", label: "允许抓取私网地址", group: "抓取", type: "bool", env: "ALLOW_PRIVATE_NETWORK_FETCH", default: false, danger: true, description: "本地调试用：fake-ip DNS 会把公网域名解析到私网段" },
  { key: "socialdata.api_key", label: "SocialData API Key", group: "采集", type: "string", env: "SOCIALDATA_API_KEY", secret: true, description: "X(Twitter) 采集用的 SocialData key（按量付费）；不填就跟 .env 里的 SOCIALDATA_API_KEY" },
]);

/** Adds entries (a module settings, or the engine ones); a later entry replaces an earlier one. */
export function registerConfigEntries(entries: readonly ConfigEntry[]): void {
  for (const entry of entries) registry.set(entry.key, entry);
}

export function listConfigEntries(): ConfigEntry[] {
  return [...registry.values()].sort((a, b) => a.group.localeCompare(b.group, "zh-Hans-CN") || a.key.localeCompare(b.key));
}

export function configEntry(key: string): ConfigEntry | undefined {
  return registry.get(key);
}

/** The settings copy of the values, as they are stored (a string for every type). */
const overrides = new Map<string, string>();

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Reads the stored values into the process. */
export async function reloadRuntimeConfig(): Promise<void> {
  const rows = (await sql.unsafe("SELECT key, value FROM settings WHERE key LIKE $1", ["config.%"])) as { key: string; value: unknown }[];
  const next = new Map<string, string>();
  for (const row of rows) {
    const raw = row.value;
    if (raw === null || raw === undefined) continue;
    next.set(row.key.slice("config.".length), typeof raw === "string" ? raw : JSON.stringify(raw));
  }
  overrides.clear();
  for (const [key, value] of next) overrides.set(key, value);
}

/** Keeps the in-process copy fresh; an admin write refreshes it at once, this is the safety net. */
export function startRuntimeConfigRefresh(intervalMs = 30_000): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    void reloadRuntimeConfig().catch(() => {});
  }, intervalMs);
  refreshTimer.unref?.();
}

function envName(entry: ConfigEntry): string {
  return entry.env ?? entry.key.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function envRaw(entry: ConfigEntry): string | undefined {
  const raw = process.env[envName(entry)];
  return raw === undefined || raw === "" ? undefined : raw;
}

/** The stored text as the type of the entry. */
function typed(entry: ConfigEntry, raw: string | undefined): string | number | boolean | null {
  if (raw === undefined) return entry.default ?? null;
  if (entry.type === "bool") return raw === "true" || raw === "1";
  if (entry.type === "int") {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : (entry.default ?? null);
  }
  return raw;
}

/** The effective value: admin, then environment, then default. */
export function runtimeValue(key: string): string | number | boolean | null {
  const entry = registry.get(key);
  if (!entry) return null;
  if (overrides.has(key)) return typed(entry, overrides.get(key));
  return typed(entry, envRaw(entry));
}

/** The value the admin stored for a key; undefined when the admin has not set one. */
export function runtimeOverride(key: string): string | number | boolean | null | undefined {
  const entry = registry.get(key);
  if (!entry) return undefined;
  const raw = overrides.get(key);
  if (raw === undefined) return undefined;
  return typed(entry, raw);
}

/** The admin value as a boolean; undefined when the admin has not set one (the caller keeps its own default). */
export function runtimeOverrideBool(key: string): boolean | undefined {
  const value = runtimeOverride(key);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return undefined;
}

export function runtimeBool(key: string): boolean {
  const value = runtimeValue(key);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return false;
}

export function runtimeInt(key: string): number {
  const value = runtimeValue(key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function runtimeString(key: string): string {
  const value = runtimeValue(key);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** The entry with its effective value and where that value comes from. */
export function configEntryState(entry: ConfigEntry): ConfigEntryState {
  const admin = overrides.get(entry.key);
  const env = envRaw(entry);
  let value: string | number | boolean | null;
  let source: "admin" | "env" | "default";
  if (admin !== undefined) {
    value = typed(entry, admin);
    source = "admin";
  } else if (env !== undefined) {
    value = typed(entry, env);
    source = "env";
  } else {
    value = entry.default ?? null;
    source = "default";
  }
  if (entry.secret) {
    return { ...entry, value: null, source, hasValue: source !== "default" && value !== null && value !== "" };
  }
  return { ...entry, value, source, hasValue: value !== null && value !== "" };
}

export function configOverview(): { entries: ConfigEntryState[] } {
  return { entries: listConfigEntries().map(configEntryState) };
}

/** Checks a value against the type of the entry; the text form is what gets stored. */
export function validateConfigValue(entry: ConfigEntry, raw: unknown): string {
  if (entry.type === "bool") {
    if (raw === true || raw === "true" || raw === 1 || raw === "1") return "true";
    if (raw === false || raw === "false" || raw === 0 || raw === "0") return "false";
    throw new ConfigError(entry.label + " 需要 true 或 false");
  }
  if (entry.type === "int") {
    const parsed = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) throw new ConfigError(entry.label + " 需要整数");
    return String(parsed);
  }
  const text = String(raw ?? "");
  if (entry.type === "enum") {
    if (!entry.options?.includes(text)) throw new ConfigError(entry.label + " 只能是 " + (entry.options?.join(" / ") ?? ""));
    return text;
  }
  return text;
}

/** Writes a value (admin), keeps the process copy in step and records the change. */
export async function setConfigValue(key: string, raw: unknown, reason: string, actor: string): Promise<ConfigEntryState> {
  const entry = registry.get(key);
  if (!entry) throw new ConfigError("未知的配置项: " + key);
  if (!reason?.trim()) throw new ConfigError("reason is required");
  const before = configEntryState(entry);
  const text = validateConfigValue(entry, raw);
  await sql.unsafe(
    "INSERT INTO settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()",
    ["config." + key, JSON.stringify(text), actor],
  );
  overrides.set(key, text);
  await audit(actor, "config.set", "config:" + key, reason, entry.secret ? null : before.value, entry.secret ? null : text);
  return configEntryState(entry);
}

/** Drops the admin value; the environment variable or the default takes over again. */
export async function resetConfigValue(key: string, reason: string, actor: string): Promise<ConfigEntryState> {
  const entry = registry.get(key);
  if (!entry) throw new ConfigError("未知的配置项: " + key);
  if (!reason?.trim()) throw new ConfigError("reason is required");
  const before = configEntryState(entry);
  await sql.unsafe("DELETE FROM settings WHERE key = $1", ["config." + key]);
  overrides.delete(key);
  await audit(actor, "config.reset", "config:" + key, reason, entry.secret ? null : before.value, null);
  return configEntryState(entry);
}
