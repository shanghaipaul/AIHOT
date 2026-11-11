// What the youtube module adds to the web pages: three entries in the sidebar that open its list, its
// subtitle library (the texts of the videos, so a reader never has to watch one) and the digest (what
// the model made of those texts).
import { IconDoc, IconFlame, IconSparkles } from "@aihot/web/components/icons";
import { defineWebModule } from "@aihot/web/modules";

export const YOUTUBE_WEB = defineWebModule({
  name: "youtube",
  sidebar: {
    section: "内容",
    items: [
      { to: "/youtube", label: "YouTube 视频", icon: IconFlame },
      { to: "/youtube/transcripts", label: "字幕库", icon: IconDoc },
      { to: "/youtube/digest", label: "精华提炼", icon: IconSparkles },
    ],
  },
});
