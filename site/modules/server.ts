// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import { DAILY_PUSH_SERVER } from "@aihot/daily-push/server";
import { GITHUB_TRENDING_SERVER } from "@aihot/github-trending/server";
import { FREEBIES_SERVER } from "@aihot/freebies/server";

export const SERVER_MODULES: readonly ServerModule[] = [DAILY_PUSH_SERVER, GITHUB_TRENDING_SERVER, FREEBIES_SERVER];
