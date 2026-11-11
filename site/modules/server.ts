// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import { DAILY_PUSH_SERVER } from "@aihot/daily-push/server";
import { GITHUB_TRENDING_SERVER } from "@aihot/github-trending/server";
import { FREEBIES_SERVER } from "@aihot/freebies/server";
import { YOUTUBE_SERVER } from "@aihot/youtube/server";
import { X_TIMELINE_SERVER } from "@aihot/x-timeline/server";

export const SERVER_MODULES: readonly ServerModule[] = [DAILY_PUSH_SERVER, GITHUB_TRENDING_SERVER, FREEBIES_SERVER, YOUTUBE_SERVER, X_TIMELINE_SERVER];
