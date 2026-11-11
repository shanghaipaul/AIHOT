// The addresses of the x-timeline module: the page that shows the account's posts (/x), the admin
// page that manages the collection (/admin/x), and the api the pages read (/api/x-timeline/).
import { defineModule } from "@aihot/contracts/modules";

export const X_TIMELINE = defineModule({
  name: "x-timeline",
  pages: [{ path: "x", file: "pages/x-timeline.tsx" }],
  adminPages: [{ path: "admin/x", file: "pages/x-admin.tsx" }],
  apiPaths: [/^\/api\/x-timeline\//],
});

export default X_TIMELINE;
