// The backend of the github-trending module: the route the page reads, the route that asks GitHub again,
// and the schedule that keeps the list fresh (the worker takes the modules' schedules,
// apps/worker/src/schedules.ts).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { loadTrending } from "./backend/api.ts";
import { collectAllTrending, collectTrending } from "./backend/collect.ts";
import { readPeriod } from "./backend/types.ts";

export { collectTrending };

/** Off when the deployment turns it off; on otherwise: the list is public information. */
const enabled = () => process.env.GITHUB_TRENDING_ENABLED !== "false";

/** When each period was last asked for, so a reader's button cannot make GitHub answer again and again. */
const lastRefresh = new Map<string, number>();
const REFRESH_GAP_MS = 5 * 60 * 1000;

function routes(app: FastifyInstance) {
  // The list, as it was last read: shared caches may keep it for ten minutes.
  app.get("/api/github-trending", async (req: FastifyRequest<{ Querystring: Record<string, unknown> }>, reply) => {
    const snapshot = await loadTrending(req.query?.period);
    return reply.header("Cache-Control", "public, s-maxage=600").type("application/json; charset=utf-8").send(snapshot);
  });
  // Asking GitHub again: one period at a time, and not more often than every five minutes.
  app.post("/api/github-trending/refresh", async (req: FastifyRequest<{ Querystring: Record<string, unknown> }>, reply) => {
    const period = readPeriod(req.query?.period);
    const now = Date.now();
    const last = lastRefresh.get(period) ?? 0;
    if (now - last < REFRESH_GAP_MS) {
      const waitSeconds = Math.ceil((REFRESH_GAP_MS - (now - last)) / 1000);
      return reply.code(429).type("application/json; charset=utf-8").send({ error: "too_soon", waitSeconds });
    }
    lastRefresh.set(period, now);
    try {
      const repos = await collectTrending(period);
      return reply.type("application/json; charset=utf-8").send({ period, count: repos.length });
    } catch (error) {
      req.log.error({ err: error, period }, "github trending refresh failed");
      return reply.code(502).type("application/json; charset=utf-8").send({ error: "fetch_failed" });
    }
  });
}

export const GITHUB_TRENDING_SERVER = defineServerModule({
  name: "github-trending",
  http: routes,
  schedules: [{ name: "github-trending.collect", cron: "23 */2 * * *", when: enabled, run: () => collectAllTrending() }],
});