// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import { GITHUB_TRENDING_WEB } from "@aihot/github-trending/web";

export const WEB_MODULES: readonly WebModule[] = [GITHUB_TRENDING_WEB];
