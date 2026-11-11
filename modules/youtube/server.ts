// The backend of the youtube module: the list the page reads, the route that asks YouTube again, and
// the three schedules that keep the channel list, the transcripts and the analyses fresh (the worker takes
// the modules' schedules, apps/worker/src/schedules.ts).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { analyzePending } from "./backend/analyze.ts";
import { loadYoutubeFeed } from "./backend/api.ts";
import { collectAll } from "./backend/fetch.ts";
import { enrichTranscripts } from "./backend/transcript.ts";

/** Off when the deployment turns it off; on otherwise: the videos are public information. */
const enabled = () => process.env.YOUTUBE_ENABLED !== "false";

/** The summaries need the model, so they wait until the model calls are switched on. */
const analyzing = () => enabled() && process.env.MODEL_CALLS_ENABLED !== "false";

/** When the collection was last asked for, so a reader's button cannot make YouTube answer again and again. */
let lastRefresh = 0;
const REFRESH_GAP_MS = 5 * 60 * 1000;

function routes(app: FastifyInstance) {
  // The videos, as they were last read: shared caches may keep them for ten minutes.
  app.get("/api/youtube", async (req: FastifyRequest<{ Querystring: { channel?: string } }>, reply) => {
    const feed = await loadYoutubeFeed({ channelId: req.query?.channel });
    return reply.header("Cache-Control", "public, s-maxage=600").type("application/json; charset=utf-8").send(feed);
  });
  // Asking YouTube again: not more often than every five minutes.
  app.post("/api/youtube/refresh", async (req: FastifyRequest, reply) => {
    const now = Date.now();
    if (now - lastRefresh < REFRESH_GAP_MS) {
      const waitSeconds = Math.ceil((REFRESH_GAP_MS - (now - lastRefresh)) / 1000);
      return reply.code(429).type("application/json; charset=utf-8").send({ error: "too_soon", waitSeconds });
    }
    lastRefresh = now;
    try {
      const result = await collectAll();
      return reply.type("application/json; charset=utf-8").send(result);
    } catch (error) {
      req.log.error({ err: error }, "youtube refresh failed");
      return reply.code(502).type("application/json; charset=utf-8").send({ error: "fetch_failed" });
    }
  });
}

export const YOUTUBE_SERVER = defineServerModule({
  name: "youtube",
  http: routes,
  // The step that turns a transcript into a Chinese summary, its points and its tags; the admin page can
  // switch its model like any other step.
  models: {
    youtubeAnalyze: {
      label: "视频分析（字幕中文摘要、要点、标签）",
      env: "YOUTUBE_ANALYZE_MODEL",
      purposes: ["youtube_analyze"],
    },
  },
  schedules: [
    // The channel list first, then the transcripts of what is new, then the analysis of what has a transcript.
    { name: "youtube.collect", cron: "13 */2 * * *", when: enabled, run: () => collectAll() },
    { name: "youtube.transcripts", cron: "27 */2 * * *", when: enabled, run: () => enrichTranscripts() },
    { name: "youtube.analyze", cron: "41 */2 * * *", when: analyzing, run: () => analyzePending() },
  ],
});
