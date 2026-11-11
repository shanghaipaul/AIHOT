// The backend of the youtube module: the list the page reads, the route that asks YouTube again, the
// subtitle archive (one by one, or all at once as one file), and the schedules that keep the channel list,
// the transcripts and the analyses fresh (the worker takes the modules' schedules, apps/worker/src/schedules.ts).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { defineServerModule } from "@aihot/backend/modules";
import { sessionPrincipal } from "@aihot/backend/admin/auth";
import { beijingDate } from "@aihot/contracts/time";
import { analyzePending } from "./backend/analyze.ts";
import {
  loadSubtitle,
  loadSubtitleArchive,
  loadYoutubeFeed,
  renderArchiveMarkdown,
  renderArchiveText,
} from "./backend/api.ts";
import { collectAll } from "./backend/fetch.ts";
import { backfillSubtitles, enrichTranscripts, purgeExpiredSubtitles } from "./backend/transcript.ts";
import { buildDigests, renderDigestsMarkdown } from "./backend/digest.ts";
import { loadDigestFeed, loadDigestRows, renderDigestsText } from "./backend/digestApi.ts";

/** Off when the deployment turns it off; on otherwise: the videos are public information. */
const enabled = () => process.env.YOUTUBE_ENABLED !== "false";

/** The summaries need the model, so they wait until the model calls are switched on. */
const analyzing = () => enabled() && process.env.MODEL_CALLS_ENABLED !== "false";

/** When the collection was last asked for, so a reader's button cannot make YouTube answer again and again. */
let lastRefresh = 0;
const REFRESH_GAP_MS = 5 * 60 * 1000;

/** The file name of a download: no spaces, so every browser saves it the same way. */
function downloadName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-");
}

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
  // All the subtitles in one file: the reader wants the text, not the videos.
  app.get("/api/youtube/subtitles/export", async (req: FastifyRequest<{ Querystring: { format?: string } }>, reply) => {
    const format = String(req.query?.format ?? "md").toLowerCase();
    const entries = await loadSubtitleArchive();
    const date = beijingDate(new Date());
    if (format === "txt") {
      return reply
        .header("Content-Disposition", 'attachment; filename="' + downloadName("youtube-subtitles-" + date + ".txt") + '"')
        .type("text/plain; charset=utf-8")
        .send(renderArchiveText(entries));
    }
    return reply
      .header("Content-Disposition", 'attachment; filename="' + downloadName("youtube-subtitles-" + date + ".md") + '"')
      .type("text/markdown; charset=utf-8")
      .send(renderArchiveMarkdown(entries, date));
  });
  // One video's subtitle: the vtt as it came, the plain text, or the record as json.
  app.get(
    "/api/youtube/subtitles/:videoId",
    async (req: FastifyRequest<{ Params: { videoId: string }; Querystring: { format?: string } }>, reply) => {
      const videoId = req.params.videoId;
      const format = String(req.query?.format ?? "vtt").toLowerCase();
      const subtitle = await loadSubtitle(videoId);
      if (!subtitle) {
        return reply.code(404).type("application/json; charset=utf-8").send({ error: "not_found" });
      }
      const base = downloadName(subtitle.videoId + "." + subtitle.language);
      if (format === "json") {
        return reply.type("application/json; charset=utf-8").send({
          videoId: subtitle.videoId,
          language: subtitle.language,
          provider: subtitle.provider,
          fetchedAt: subtitle.fetchedAt,
          content: subtitle.content,
          contentText: subtitle.contentText,
        });
      }
      if (format === "txt") {
        return reply
          .header("Content-Disposition", 'attachment; filename="' + base + '.txt"')
          .type("text/plain; charset=utf-8")
          .send(subtitle.contentText);
      }
      return reply
        .header("Content-Disposition", 'attachment; filename="' + base + '.vtt"')
        .type("text/vtt; charset=utf-8")
        .send(subtitle.content);
    },
  );
  // Filling in the subtitles that are missing: for the editor only, it asks the instances again.
  app.post(
    "/api/youtube/subtitles/backfill",
    async (req: FastifyRequest<{ Querystring: { limit?: string } }>, reply) => {
      const admin = await sessionPrincipal(req.headers.cookie);
      if (!admin) {
        return reply.code(401).type("application/json; charset=utf-8").send({ error: "unauthorized" });
      }
      if (req.headers["x-csrf-token"] !== admin.csrf) {
        return reply.code(403).type("application/json; charset=utf-8").send({ error: "forbidden" });
      }
      const asked = Number(req.query?.limit ?? 0);
      const limit = Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : 0;
      try {
        const result = await backfillSubtitles(limit);
        return reply.type("application/json; charset=utf-8").send(result);
      } catch (error) {
        req.log.error({ err: error }, "youtube subtitle backfill failed");
        return reply.code(502).type("application/json; charset=utf-8").send({ error: "backfill_failed" });
      }
    },
  );
  // The distilled subtitles: the reader gets the conclusion, the points and the numbers without watching the video.
  app.get("/api/youtube/digests", async (req: FastifyRequest, reply) => {
    const feed = await loadDigestFeed();
    return reply.header("Cache-Control", "public, s-maxage=600").type("application/json; charset=utf-8").send(feed);
  });
  // All the distilled notes in one file: markdown by default, plain text if asked for.
  app.get("/api/youtube/digests/export", async (req: FastifyRequest<{ Querystring: { format?: string } }>, reply) => {
    const format = String(req.query?.format ?? "md").toLowerCase();
    const rows = await loadDigestRows();
    const date = beijingDate(new Date());
    if (format === "txt") {
      return reply
        .header("Content-Disposition", 'attachment; filename="' + downloadName("youtube-digests-" + date + ".txt") + '"')
        .type("text/plain; charset=utf-8")
        .send(renderDigestsText(rows));
    }
    return reply
      .header("Content-Disposition", 'attachment; filename="' + downloadName("youtube-digests-" + date + ".md") + '"')
      .type("text/markdown; charset=utf-8")
      .send(renderDigestsMarkdown(rows, { date }));
  });
  // Distilling the subtitles: for the editor only, it asks the model to read them.
  app.post("/api/youtube/digests/build", async (req: FastifyRequest<{ Body: { limit?: number } }>, reply) => {
    const admin = await sessionPrincipal(req.headers.cookie);
    if (!admin) {
      return reply.code(401).type("application/json; charset=utf-8").send({ error: "unauthorized" });
    }
    if (req.headers["x-csrf-token"] !== admin.csrf) {
      return reply.code(403).type("application/json; charset=utf-8").send({ error: "forbidden" });
    }
    const asked = Number(req.body?.limit ?? 0);
    const limit = Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : undefined;
    try {
      const result = await buildDigests(limit === undefined ? {} : { limit });
      return reply.type("application/json; charset=utf-8").send(result);
    } catch (error) {
      req.log.error({ err: error }, "youtube digest build failed");
      return reply.code(502).type("application/json; charset=utf-8").send({ error: "build_failed" });
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
      purposes: ["youtube_analyze", "youtube_digest"],
    },
  },
  schedules: [
    // The channel list first, then the transcripts of what is new, then the analysis of what has a transcript.
    { name: "youtube.collect", cron: "13 */2 * * *", when: enabled, run: () => collectAll() },
    { name: "youtube.transcripts", cron: "27 */2 * * *", when: enabled, run: () => enrichTranscripts() },
    { name: "youtube.analyze", cron: "41 */2 * * *", when: analyzing, run: () => analyzePending() },
    // The subtitle files on disk are kept for a year; the text itself stays in the table.
    { name: "youtube.subtitles.gc", cron: "17 4 * * *", when: enabled, run: () => purgeExpiredSubtitles(365) },
  ],
});
