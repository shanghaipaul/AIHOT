// What the x-timeline module adds to the web pages: one entry in the sidebar that opens its timeline, and
// one entry in the admin's navigation that opens the page where the account is managed.
import { IconMessage } from "@aihot/web/components/icons";
import { defineWebModule } from "@aihot/web/modules";

export const X_TIMELINE_WEB = defineWebModule({
  name: "x-timeline",
  sidebar: { section: "内容", items: [{ to: "/x", label: "X 时间线", icon: IconMessage }] },
  admin: { content: [{ to: "/admin/x", label: "X 时间线" }] },
});
