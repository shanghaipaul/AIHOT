// The addresses of the youtube module: the list page (/youtube) and the api the page reads
// (/api/youtube/). The web server forwards those prefixes to the api process, so a reader reaches the
// list without the page knowing where the answer came from.
import { defineModule } from "@aihot/contracts/modules";

export const YOUTUBE = defineModule({
  name: "youtube",
  pages: [{ path: "youtube", file: "pages/youtube.tsx" }],
  apiPaths: [/^\/api\/youtube\//],
});
