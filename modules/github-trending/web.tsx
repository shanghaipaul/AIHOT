// What the github-trending module adds to the web pages: one entry in the sidebar that opens its list.
import { IconGithub } from "@aihot/web/components/icons";
import { defineWebModule } from "@aihot/web/modules";

export const GITHUB_TRENDING_WEB = defineWebModule({
  name: "github-trending",
  sidebar: { section: "内容", items: [{ to: "/github-trending", label: "GitHub 趋势", icon: IconGithub }] },
});