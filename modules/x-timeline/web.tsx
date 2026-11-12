// What the x-timeline module adds to the web pages: one entry in the sidebar that opens its timeline, one
// entry in the admin's navigation that opens the page where the account is managed, and the block of the
// newest posts above the home page.
import { IconMessage } from "@aihot/web/components/icons";
import { defineWebModule } from "@aihot/web/modules";
import XHomeStrip from "./pages/x-home-strip";

export const X_TIMELINE_WEB = defineWebModule({
  name: "x-timeline",
  sidebar: { section: "内容", items: [{ to: "/x", label: "X 时间线", icon: IconMessage }] },
  admin: { content: [{ to: "/admin/x", label: "X 时间线" }] },
  root: { Top: XHomeStrip },
});
