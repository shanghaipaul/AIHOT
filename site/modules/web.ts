// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import { GITHUB_TRENDING_WEB } from "@aihot/github-trending/web";
import { FREEBIES_WEB } from "@aihot/freebies/web";
import { YOUTUBE_WEB } from "@aihot/youtube/web";
import { X_TIMELINE_WEB } from "@aihot/x-timeline/web";

export const WEB_MODULES: readonly WebModule[] = [GITHUB_TRENDING_WEB, FREEBIES_WEB, YOUTUBE_WEB, X_TIMELINE_WEB];
