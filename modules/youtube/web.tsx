// What the youtube module adds to the web pages: one entry in the sidebar that opens its list.
import { IconFlame } from "@aihot/web/components/icons";
import { defineWebModule } from "@aihot/web/modules";

export const YOUTUBE_WEB = defineWebModule({
  name: "youtube",
  sidebar: { section: "内容", items: [{ to: "/youtube", label: "YouTube 视频", icon: IconFlame }] },
});
