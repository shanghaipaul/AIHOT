// What the settings say right now: the account to read, how to read it, how often, and how much
// a day may cost. The owner writes them in the configuration centre; the environment variables the
// template documents are the fallback, and the centre wins over them.
import { credential } from "@aihot/backend/config";
import { runtimeBool, runtimeOverride, runtimeOverrideBool, runtimeString } from "@aihot/backend/runtime-config";
import { normalizeHandle } from "./handle.ts";
import { DEFAULT_DAILY_CAP, DEFAULT_INTERVAL_MINUTES, X_TIMELINE_KEY } from "./settings.ts";
import type { XTimelineMode } from "./types.ts";

/** The configuration, as the module reads it. */
export interface XTimelineConfig {
  handle: string;
  mode: XTimelineMode;
  includeReplies: boolean;
  cookie: string;
  intervalMinutes: number;
  dailyCap: number;
}

/** The environment variables the template documents, read by name. */
const envHandle = process.env.X_TIMELINE_HANDLE ?? "";
const envMode = process.env.X_TIMELINE_MODE ?? "";
const envIncludeReplies = process.env.X_TIMELINE_INCLUDE_REPLIES === "true";
const envIntervalMinutes = Number(process.env.X_TIMELINE_INTERVAL_MINUTES ?? 0);
const envDailyCap = Number(process.env.X_TIMELINE_DAILY_CAP ?? 0);

/** Whether the paid api key is there: a yes or a no, never the key itself. */
export function hasSocialDataKey(): boolean {
  return Boolean(runtimeString("socialdata.api_key") || process.env.SOCIALDATA_API_KEY || credential("collectors", "SOCIALDATA_API_KEY"));
}

/** The settings, read now. The configuration centre wins; the environment is the fallback. */
export function readConfig(): XTimelineConfig {
  const mode = runtimeOverride(X_TIMELINE_KEY.mode) ?? envMode;
  const interval = Number(runtimeOverride(X_TIMELINE_KEY.intervalMinutes) ?? envIntervalMinutes);
  const cap = Number(runtimeOverride(X_TIMELINE_KEY.dailyCap) ?? envDailyCap);
  return {
    handle: normalizeHandle(String(runtimeOverride(X_TIMELINE_KEY.handle) ?? envHandle)),
    mode: mode === "cookie" ? "cookie" : "socialdata",
    includeReplies: runtimeOverrideBool(X_TIMELINE_KEY.includeReplies) ?? envIncludeReplies,
    cookie: runtimeString(X_TIMELINE_KEY.cookie),
    intervalMinutes: interval > 0 ? Math.min(1440, interval) : DEFAULT_INTERVAL_MINUTES,
    dailyCap: cap > 0 ? cap : DEFAULT_DAILY_CAP,
  };
}
