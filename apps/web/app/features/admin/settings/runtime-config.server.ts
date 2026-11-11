// The settings page reads the runtime configuration with the visitor's own cookie, like every other
// admin page. A missing or failing endpoint must not take the whole page down: the card shows the
// reason and the rest of the settings stay usable.
import { adminGet } from "../../../lib/admin.server";
import type { AdminConfigEntry, AdminConfigResponse } from "./config-types";

export interface RuntimeConfigData {
  entries: AdminConfigEntry[];
  /** Why the configuration could not be read, when it could not. */
  error: string | null;
}

/** Reads /api/admin/config; a sign-in redirect belongs to the whole page and is passed through. */
export async function loadRuntimeConfig(request: Request): Promise<RuntimeConfigData> {
  try {
    const res = await adminGet<AdminConfigResponse>(request, "/api/admin/config");
    return { entries: Array.isArray(res?.entries) ? res.entries : [], error: null };
  } catch (error) {
    if (error instanceof Response) throw error;
    const message = (error as { data?: { message?: unknown } })?.data?.message;
    return { entries: [], error: typeof message === "string" && message ? message : "无法读取运行配置" };
  }
}
