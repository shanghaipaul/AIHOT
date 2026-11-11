// The backend of the x-timeline module: the posts of one X account as the page shows them, the three
// routes that manage the collection, and the schedule that keeps the source in step with the
// configuration and with the daily cost cap.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { actorOf, sessionPrincipal, type AdminPrincipal } from "@aihot/backend/admin/auth";
import { Conflict } from "@aihot/backend/audit";
import { fetchNow } from "@aihot/backend/admin/sources";
import { UnsupportedConfig } from "@aihot/backend/sources/config-keys";
import { setConfigValue } from "@aihot/backend/runtime-config";
import { hasSocialDataKey, readConfig } from "./backend/config.ts";
import { collectSyndication } from "./backend/collect.ts";
import { countXPostsSince, loadXPosts } from "./backend/posts.ts";
import { lastCollection, minutesSinceLastCollection, recordCollection } from "./backend/runs.ts";
import { X_TIMELINE_KEY, X_TIMELINE_SETTINGS } from "./backend/settings.ts";
import {
  X_TIMELINE_ACTOR,
  X_TIMELINE_EMBED_SOURCE_ID,
  X_TIMELINE_SOURCE_ID,
  XTimelineError,
  ensureXSource,
  findSourceById,
  findXSource,
  normalizeHandle,
  setSourceEnabled,
} from "./backend/source.ts";
import { buildTimelineState, sourceSummary } from "./backend/state.ts";
import type { XSourceRow, XTimelineMode } from "./backend/types.ts";

/** Who is behind the request: the module's routes do not stand behind the framework's admin shield. */
async function principalOf(req: FastifyRequest): Promise<AdminPrincipal | null> {
  return await sessionPrincipal(req.headers.cookie);
}

/** The source the page talks about: the one the current mode collects with. */
async function currentSource(handle: string, mode: XTimelineMode): Promise<XSourceRow | null> {
  if (mode === "syndication") return await findSourceById(X_TIMELINE_EMBED_SOURCE_ID);
  return (await findXSource(handle)) ?? (await findSourceById(X_TIMELINE_SOURCE_ID));
}

/** Both sources of the module: the posts of the account live in either of them. */
const SOURCE_IDS = [X_TIMELINE_SOURCE_ID, X_TIMELINE_EMBED_SOURCE_ID];

/** What an error says, in Chinese, with the status code it deserves. */
function failure(error: unknown): { status: number; message: string } {
  if (error instanceof XTimelineError) return { status: error.statusCode, message: error.message };
  if (error instanceof Conflict) return { status: 409, message: error.message };
  if (error instanceof UnsupportedConfig) return { status: 400, message: error.message };
  if (error instanceof Error && error.name === "ZodError") {
    return { status: 400, message: "参数不合法，请检查填写的内容" };
  }
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 600) {
    return { status, message: error instanceof Error ? error.message : "操作失败，请稍后再试" };
  }
  return { status: 500, message: "操作失败，请稍后再试" };
}

/** The way the configuration is written down, as the admin page answers it. */
function configSummary(handle: string, mode: XTimelineMode, proxy: string) {
  return { handle, mode, hasProxy: Boolean(proxy) };
}

function routes(app: FastifyInstance) {
  // The timeline: what is configured, the source and the posts collected so far.
  app.get("/api/x-timeline", async (_req: FastifyRequest, reply) => {
    const config = readConfig();
    const source = await currentSource(config.handle, config.mode);
    const posts = await loadXPosts(SOURCE_IDS, 50);
    const state = buildTimelineState({
      handle: config.handle,
      mode: config.mode,
      hasKey: hasSocialDataKey(),
      hasProxy: Boolean(config.proxy),
      source: source ? sourceSummary(source) : null,
      posts,
      lastCollection: await lastCollection(),
    });
    return reply
      .header("Cache-Control", "public, s-maxage=30")
      .type("application/json; charset=utf-8")
      .send(state);
  });

  // Asking for a collection now: only the person behind the screen may.
  app.post("/api/x-timeline/refresh", async (req: FastifyRequest, reply) => {
    const principal = await principalOf(req);
    if (!principal) {
      return reply.code(401).type("application/json; charset=utf-8").send({ error: "请先登录管理后台" });
    }
    const config = readConfig();
    if (!config.handle) {
      return reply.code(400).type("application/json; charset=utf-8").send({ error: "还没有填写 X 用户名，请先在配置中心填写" });
    }
    if (config.mode === "cookie") {
      return reply
        .code(400)
        .type("application/json; charset=utf-8")
        .send({ error: "cookie 方式还没有接入采集器，请改用 syndication 或 socialdata" });
    }
    try {
      if (config.mode === "socialdata") {
        if (!hasSocialDataKey()) {
          return reply
            .code(400)
            .type("application/json; charset=utf-8")
            .send({ error: "缺少 SOCIALDATA_API_KEY，采集无法进行" });
        }
        const source = await ensureXSource(config.handle, {
          mode: config.mode,
          includeReplies: config.includeReplies,
          intervalMinutes: config.intervalMinutes,
        });
        const job = await fetchNow(source.id, actorOf(principal));
        if (!job) {
          return reply.code(400).type("application/json; charset=utf-8").send({ error: "采集源不存在，无法采集" });
        }
        return reply.type("application/json; charset=utf-8").send({
          ok: true,
          status: 0,
          found: 0,
          created: 0,
          skipped: 0,
          error: null,
          sourceId: source.id,
          jobId: job.jobId ?? null,
        });
      }
      // The embedded timeline: it counts every request of the exit address, so a run that was told
      // "too fast" says so instead of passing for an account without posts.
      if (!config.proxy) {
        return reply
          .code(400)
          .type("application/json; charset=utf-8")
          .send({ error: "还没有配置采集代理：syndication 方式需要代理才能连上 x.com" });
      }
      const last = await lastCollection();
      const minutes = await minutesSinceLastCollection();
      if (last && last.status === 200 && minutes !== null && minutes < config.minGapMinutes) {
        return reply.code(429).type("application/json; charset=utf-8").send({
          ok: false,
          status: 429,
          found: 0,
          created: 0,
          skipped: 0,
          error:
            "距离上一次采集才 " + minutes + " 分钟，最小间隔是 " + config.minGapMinutes + " 分钟，请稍后再试",
        });
      }
      const source = await ensureXSource(config.handle, {
        mode: config.mode,
        includeReplies: config.includeReplies,
        intervalMinutes: config.intervalMinutes,
      });
      const result = await collectSyndication({
        sourceId: source.id,
        handle: config.handle,
        proxyUrl: config.proxy,
        includeReplies: config.includeReplies,
        limit: 50,
      });
      await recordCollection({
        mode: "syndication",
        sourceId: source.id,
        status: result.status,
        found: result.found,
        created: result.created,
        skipped: result.skipped,
        error: result.error,
      });
      return reply.type("application/json; charset=utf-8").send({
        ok: result.status === 200 && !result.error,
        status: result.status,
        found: result.found,
        created: result.created,
        skipped: result.skipped,
        error: result.error,
        sourceId: source.id,
      });
    } catch (error) {
      req.log.error({ err: error }, "x-timeline refresh failed");
      const { status, message } = failure(error);
      return reply.code(status).type("application/json; charset=utf-8").send({ error: message });
    }
  });

  // The source of the account: write the configuration, keep the source in step, pause it, resume it.
  app.post("/api/x-timeline/source", async (req: FastifyRequest<{ Body: Record<string, unknown> }>, reply) => {
    const principal = await principalOf(req);
    if (!principal) {
      return reply.code(401).type("application/json; charset=utf-8").send({ error: "请先登录管理后台" });
    }
    const actor = actorOf(principal);
    const body = req.body ?? {};
    const action = String(body.action ?? "").trim();
    const config = readConfig();
    try {
      if (action === "create" || action === "update") {
        const handle = normalizeHandle(String(body.handle ?? config.handle));
        if (!handle) {
          return reply.code(400).type("application/json; charset=utf-8").send({ error: "还没有填写 X 用户名" });
        }
        const mode = String(body.mode ?? config.mode).trim().toLowerCase();
        await setConfigValue(X_TIMELINE_KEY.handle, handle, "后台保存 X 时间线的账号", actor);
        await setConfigValue(X_TIMELINE_KEY.mode, mode, "后台保存 X 时间线的采集方式", actor);
        if (typeof body.includeReplies === "boolean") {
          await setConfigValue(
            X_TIMELINE_KEY.includeReplies,
            body.includeReplies ? "true" : "false",
            "后台保存 X 时间线的采集配置",
            actor,
          );
        }
        const minutes = Number(body.intervalMinutes);
        if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440) {
          await setConfigValue(
            X_TIMELINE_KEY.intervalMinutes,
            String(Math.trunc(minutes)),
            "后台保存 X 时间线的采集间隔",
            actor,
          );
        }
        const proxy = String(body.proxy ?? "").trim();
        // An empty proxy keeps the stored one: the page never shows it, so it is never rewritten by accident.
        if (proxy) await setConfigValue(X_TIMELINE_KEY.proxy, proxy, "后台保存 X 时间线的采集代理", actor);
        const next = readConfig();
        const source = await ensureXSource(next.handle, {
          mode: next.mode,
          includeReplies: next.includeReplies,
          intervalMinutes: next.intervalMinutes,
        });
        return reply.type("application/json; charset=utf-8").send({
          ok: true,
          source: sourceSummary(source),
          config: configSummary(next.handle, next.mode, next.proxy),
        });
      }
      if (action === "pause" || action === "resume") {
        const source = await currentSource(config.handle, config.mode);
        if (!source) {
          return reply.code(400).type("application/json; charset=utf-8").send({ error: "还没有采集源，请先创建" });
        }
        const updated = await setSourceEnabled(source.id, action === "resume", actor);
        if (!updated) {
          return reply.code(404).type("application/json; charset=utf-8").send({ error: "采集源不存在" });
        }
        return reply.type("application/json; charset=utf-8").send({
          ok: true,
          source: sourceSummary(updated),
          config: configSummary(config.handle, config.mode, config.proxy),
        });
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
  const collected = await countXPostsSince(SOURCE_IDS, since);
  if (collected >= config.dailyCap) {
    const paused = source.enabled ? await setSourceEnabled(source.id, false, X_TIMELINE_ACTOR) : null;
    return { sourceId: source.id, collected, cap: config.dailyCap, paused: Boolean(paused) };
  }
  if (config.mode === "syndication") {
    if (!config.proxy) return { sourceId: source.id, collected, cap: config.dailyCap, skipped: "还没有配置采集代理" };
    const last = await lastCollection();
    const minutes = await minutesSinceLastCollection();
    const gap = Math.max(config.minGapMinutes, config.intervalMinutes);
    if (last && last.status === 200 && minutes !== null && minutes < gap) {
      return { sourceId: source.id, collected, skipped: "距离上一次采集才 " + minutes + " 分钟" };
    }
    const result = await collectSyndication({
      sourceId: source.id,
      handle: config.handle,
      proxyUrl: config.proxy,
      includeReplies: config.includeReplies,
      limit: 50,
    });
    await recordCollection({
      mode: "syndication",
      sourceId: source.id,
      status: result.status,
      found: result.found,
      created: result.created,
      skipped: result.skipped,
      error: result.error,
    });
    return { sourceId: source.id, collected, cap: config.dailyCap, ...result };
  }
  return { sourceId: source.id, query: source.config?.query ?? "", collected, cap: config.dailyCap, paused: false };
}

export const X_TIMELINE_SERVER = defineServerModule({
  name: "x-timeline",
  http: routes,
  // The entries the configuration centre shows under "X 账号".
  settings: X_TIMELINE_SETTINGS,
  // The module reads the embedded timeline itself, so the admin's manual fetch goes through it.
  sourceKinds: {
    external: {
      fetchNow: async (source) => {
        if (source.id !== X_TIMELINE_EMBED_SOURCE_ID) {
          return { skipped: "这个外部源不是 X 时间线的采集源" };
        }
        const config = readConfig();
        if (!config.handle) return { skipped: "还没有配置 X 用户名" };
        if (!config.proxy) return { skipped: "还没有配置采集代理" };
        const result = await collectSyndication({
          sourceId: source.id,
          handle: config.handle,
          proxyUrl: config.proxy,
          includeReplies: config.includeReplies,
          limit: 50,
        });
        await recordCollection({
          mode: "syndication",
          sourceId: source.id,
          status: result.status,
          found: result.found,
          created: result.created,
          skipped: result.skipped,
          error: result.error,
        });
        return {
          status: result.status,
          found: result.found,
          created: result.created,
          skipped: result.skipped,
          error: result.error,
        };
      },
    },
  },
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
