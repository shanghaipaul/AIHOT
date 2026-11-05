// The addresses of the freebies module: the list page (/freebies) and the api the page reads
// (/api/freebies/). The web server forwards those prefixes to the api process, so a reader reaches the
// list without the page knowing where the answer came from.
import { defineModule } from "@aihot/contracts/modules";

export const FREEBIES = defineModule({
  name: "freebies",
  pages: [{ path: "freebies", file: "pages/freebies.tsx" }],
  apiPaths: [/^\/api\/freebies\//],
});
