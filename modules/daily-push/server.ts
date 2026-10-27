// The backend of the daily-push module: it writes the daily report to a file when the issue is out.
// The worker takes the schedules of the installed modules (apps/worker/src/schedules.ts), so the
// engine needs no change for this to run.
import { defineServerModule } from "@aihot/backend/modules";
import { pushDaily, pushLatestDaily } from "./backend/push.ts";

export { pushDaily, pushLatestDaily };

/** Off unless the deployment turns it on, like the engine other switches. */
const enabled = () => process.env.DAILY_PUSH_ENABLED === "true";

export const DAILY_PUSH_SERVER = defineServerModule({
  name: "daily-push",
  schedules: [{ name: "daily-push.push", cron: "35 8 * * *", when: enabled, run: () => pushLatestDaily() }],
});