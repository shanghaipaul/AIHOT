// The addresses of the github-trending module: the list page (/github-trending) and the api the page
// reads (/api/github-trending/). The web server forwards those prefixes to the api process, so a reader
// reaches the list without the page knowing where the answer came from.
import { defineModule } from "@aihot/contracts/modules";

export const GITHUB_TRENDING = defineModule({
  name: "github-trending",
  pages: [{ path: "github-trending", file: "pages/trending.tsx" }],
  apiPaths: [/^\/api\/github-trending\//],
});