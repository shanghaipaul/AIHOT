// What the youtube module adds to the web pages: two entries in the sidebar that open its list and its
// subtitle library (the texts of the videos, so a reader never has to watch one).
import { IconDoc, IconFlame } from "@aihot/web/components/icons";
import { defineWebModule } from "@aihot/web/modules";

export const YOUTUBE_WEB = defineWebModule({
  name: "youtube",
  sidebar: {
    section: "内容",
    items: [
      { to: "/youtube", label: "YouTube 视频", icon: IconFlame },
      { to: "/youtube/transcripts", label: "字幕库", icon: IconDoc },
    ],
  },
});
