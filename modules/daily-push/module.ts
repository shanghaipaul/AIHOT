// The addresses of the daily-push module: it has no page and no path of its own, so only the site
// server list knows it.
import { defineModule } from "@aihot/contracts/modules";

export const DAILY_PUSH = defineModule({ name: "daily-push" });