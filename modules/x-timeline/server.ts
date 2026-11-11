// The backend of the x-timeline module: the posts of one X account as the page shows them, the
// three routes that manage the collection, and the schedule that keeps the source in step with the
// configuration and with the daily cost cap.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { actorOf, sessionPrincipal, type AdminPrincipal } from "@aihot/backend/admin/auth";
import { Conflict } from "@aihot/backend/audit";
import { fetchNow } from "@aihot/backend/admin/sources";
import { UnsupportedConfig } from "@aihot/backend/sources/config-keys";
import { hasSocialDataKey, readConfig } from "./backend/config.ts";
import { countXPostsSince, loadXPosts } from "./backend/posts.ts";
import { X_TIMELINE_SETTINGS } from "./backend/settings.ts";
import {
  X_TIMELINE_ACTOR,
  X_TIMELINE_SOURCE_ID,
  XTimelineError,
  ensureXSource,
  findSourceById,
  findXSource,
  setSourceEnabled,
} from "./backend/source.ts";
import { buildTimelineState, sourceSummary } from "./backend/state.ts";
import type { XSourceRow } from "./backend/types.ts";

/** Who is behind the request: the module's routes do not stand behind the framework's admin shield. */
async function principalOf(req: FastifyRequest): Promise<AdminPrincipal | null> {
  return await sessionPrincipal(req.headers.cookie);
}

/** The source that answers the configured account: the account's own source, else this module's row. */
async function currentSource(handle: string): Promise<XSourceRow | null> {
  const byHandle = handle ? await findXSource(handle) : null;
  if (byHandle) return byHandle;
  return await findSourceById(X_TIMELINE_SOURCE_ID);
}

/** What an error says, in Chinese, with the status code it deserves. */
function failure(error: unknown): { status: number; message: string } {
  if (error instanceof XTimelineError) return { status: error.statusCode, message: error.message };
  if (error instanceof Conflict) return { status: 409, message: error.message };
  if (error instanceof UnsupportedConfig) return { status: 400, message: error.message };
  if (error instanceof Error && error.name === "ZodError") {
    return { status: 400, message: "参数不合法，请检查填写的内容" };
  }
  return { status: 500, message: "操作失败，请稍后再试" };
}

function routes(app: FastifyInstance) {
  // The timeline: what is configured, the source and the posts collected so far.
  app.get("/api/x-timeline", async (_req: FastifyRequest, reply) => {
    const config = readConfig();
    const source = await currentSource(config.handle);
    const posts = source ? await loadXPosts(source.id, 50) : [];
    const state = buildTimelineState({
      handle: config.handle,
      mode: config.mode,
      hasKey: hasSocialDataKey(),
      source: source ? sourceSummary(source) : null,
      posts,
    });
    return reply
      .header("Cache-Control", "public, s-maxage=30")
      .type("application/json; charset=utf-8")
      .send(state);
  });

  // Asking for a collection now: only the person behind the screen may, and only with a key.
  app.post("/api/x-timeline/refresh", async (req: FastifyRequest, reply) => {
    const principal = await principalOf(req);
    if (!principal) {
      return reply.code(401).type("application/json; charset=utf-8").send({ error: "请先登录管理后台" });
    }
    const config = readConfig();
    if (!config.handle) {
      return reply.code(400).type("application/json; charset=utf-8").send({ error: "还没有填写 X 用户名，请先在配置中心填写" });
    }
    if (!hasSocialDataKey()) {
      return reply.code(400).type("application/json; charset=utf-8").send({ error: "缺少 SOCIALDATA_API_KEY，采集无法进行" });
    }
    if (config.mode === "cookie") {
      return reply.code(400).type("application/json; charset=utf-8").send({ error: "cookie 方式还没有接入采集器，请改用 socialdata" });
    }
    try {
      const source = await ensureXSource(config.handle, {
        mode: config.mode,
        includeReplies: config.includeReplies,
        intervalMinutes: config.intervalMinutes,
      });
      const job = await fetchNow(source.id, actorOf(principal));
      if (!job) {
        return reply.code(400).type("application/json; charset=utf-8").send({ error: "采集源不存在，无法采集" });
      }
      return reply.type("application/json; charset=utf-8").send({ ok: true, sourceId: source.id, jobId: job.jobId ?? null });
    } catch (error) {
      req.log.error({ err: error }, "x-timeline refresh failed");
      const { status, message } = failure(error);
      return reply.code(status).type("application/json; charset=utf-8").send({ error: message });
    }
  });

  // The source of the account: create it, keep it in step with the configuration, pause it, resume it.
  app.post("/api/x-timeline/source", async (req: FastifyRequest<{ Body: { action?: string } }>, reply) => {
    const principal = await principalOf(req);
    if (!principal) {
      return reply.code(401).type("application/json; charset=utf-8").send({ error: "请先登录管理后台" });
    }
    const action = String(req.body?.action ?? "").trim();
    const config = readConfig();
    try {
      if (action === "create" || action === "update") {
        if (!config.handle) {
          return reply.code(400).type("application/json; charset=utf-8").send({ error: "还没有填写 X 用户名，请先在配置中心填写" });
        }
        const source = await ensureXSource(config.handle, {
          mode: config.mode,
          includeReplies: config.includeReplies,
          intervalMinutes: config.intervalMinutes,
        });
        return reply.type("application/json; charset=utf-8").send({ ok: true, source: sourceSummary(source) });
      }
      if (action === "pause" || action === "resume") {
        const source = await currentSource(config.handle);
        if (!source) {
          return reply.code(400).type("application/json; charset=utf-8").send({ error: "还没有采集源，请先创建" });
        }
        const updated = await setSourceEnabled(source.id, action === "resume", actorOf(principal));
        if (!updated) {
          return reply.code(404).type("application/json; charset=utf-8").send({ error: "采集源不存在" });
        }
        return reply.type("application/json; charset=utf-8").send({ ok: true, source: sourceSummary(updated) });
      }
      return reply.code(400).type("application/json; charset=utf-8").send({ error: "未知的操作：" + (action || "（空）") });
    } catch (error) {
      req.log.error({ err: error }, "x-timeline source action failed");
      const { status, message } = failure(error);
      return reply.code(status).type("application/json; charset=utf-8").send({ error: message });
    }
  });
}

/** Keeps the source in step with the configuration and holds the daily cost. */
async function syncTimeline(): Promise<Record<string, unknown>> {
  const config = readConfig();
  if (!config.handle) return { skipped: "还没有配置 X 用户名" };
  const source = await ensureXSource(config.handle, {
    mode: config.mode,
    includeReplies: config.includeReplies,
    intervalMinutes: config.intervalMinutes,
  });
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const collected = await countXPostsSince(source.id, since);
  if (collected >= config.dailyCap && source.enabled) {
    const paused = await setSourceEnabled(source.id, false, X_TIMELINE_ACTOR);
    return { sourceId: source.id, collected, cap: config.dailyCap, paused: Boolean(paused) };
  }
  return { sourceId: source.id, query: source.config?.query ?? "", collected, cap: config.dailyCap, paused: false };
}

export const X_TIMELINE_SERVER = defineServerModule({
  name: "x-timeline",
  http: routes,
  // The six entries the configuration centre shows under "X 账号".
  settings: X_TIMELINE_SETTINGS,
  schedules: [
    // Every three hours: the source follows the configuration, and the daily cap holds the cost.
    {
      name: "x-timeline.source",
      cron: "17 */3 * * *",
      missed: "once",
      run: async () => {
        try {
          return await syncTimeline();
        } catch (error) {
          return { error: error instanceof Error ? error.message : "同步失败" };
        }
      },
    },
  ],
});
