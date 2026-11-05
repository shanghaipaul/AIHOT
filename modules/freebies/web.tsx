// What the freebies module adds to the web pages: one entry in the sidebar that opens its list.
import { IconSparkles } from "@aihot/web/components/icons";
import { defineWebModule } from "@aihot/web/modules";

export const FREEBIES_WEB = defineWebModule({
  name: "freebies",
  sidebar: { section: "内容", items: [{ to: "/freebies", label: "薅羊毛", icon: IconSparkles }] },
});
