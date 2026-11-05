// The backend of the freebies module: the route the page reads, the route that asks for the
// list again, and the schedule that keeps it fresh (the worker takes the modules' schedules,
// apps/worker/src/schedules.ts).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { loadFreebies } from "./backend/api.ts";
import { collectFreebies } from "./backend/collect.ts";

export { collectFreebies };

/** Off when the deployment turns it off; on otherwise: the list is public information. */
const enabled = () => process.env.FREEBIES_ENABLED !== "false";

/** When the list was last asked for, so a reader's button cannot make the site read again and again. */
let lastRefresh = 0;
const REFRESH_GAP_MS = 5 * 60 * 1000;

function routes(app: FastifyInstance) {
  // The list, as it was last read: shared caches may keep it for ten minutes.
  app.get("/api/freebies", async (_req: FastifyRequest, reply) => {
    const snapshot = await loadFreebies();
    return reply.header("Cache-Control", "public, s-maxage=600").type("application/json; charset=utf-8").send(snapshot);
  });
  // Asking again: not more often than every five minutes.
  app.post("/api/freebies/refresh", async (req: FastifyRequest, reply) => {
    const now = Date.now();
    if (now - lastRefresh < REFRESH_GAP_MS) {
      const waitSeconds = Math.ceil((REFRESH_GAP_MS - (now - lastRefresh)) / 1000);
      return reply.code(429).type("application/json; charset=utf-8").send({ error: "too_soon", waitSeconds });
    }
    lastRefresh = now;
    try {
      const result = await collectFreebies();
      return reply.type("application/json; charset=utf-8").send({ count: result.count });
    } catch (error) {
      req.log.error({ err: error }, "freebies refresh failed");
      return reply.code(502).type("application/json; charset=utf-8").send({ error: "fetch_failed" });
    }
  });
}

export const FREEBIES_SERVER = defineServerModule({
  name: "freebies",
  http: routes,
  schedules: [{ name: "freebies.collect", cron: "17 */6 * * *", when: enabled, run: () => collectFreebies() }],
});
