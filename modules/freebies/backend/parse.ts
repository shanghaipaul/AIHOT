// Reading the free-for.dev list: the markdown file that holds it is a list of headings
// ("## Generative AI"), each with services under it ("* [Name](url) - what is free"), and some services
// carry their own lines of detail below them.

/** One service of the list. */
export interface FreebieEntry {
  /** The heading the service sits under, in English. */
  category: string;
  name: string;
  url: string;
  /** What is free, in the list's own words. */
  detail: string;
}

/** A service line: two spaces, a bullet, the name in brackets, the link, then the description. */
const SERVICE = /^ {2}\* \[([^\]]+)\]\(([^)]+)\) ?(?:[-–—] ?(.*))?$/;
/** A line of detail under a service: four spaces and a bullet. */
const QUOTA = /^ {4}\* (.+)$/;
/** A heading of the file: two hashes and its name. */
const HEADING = /^## ?(.+?) *$/;

/**
 * The list is written in markdown; the page shows plain text. So a link becomes the words it
 * points at, and the emphasis marks go away.
 */
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Puts two pieces of text together without losing either. */
function join(text: string, more: string): string {
  const rest = plainText(more);
  const head = plainText(text);
  if (!rest) return head;
  if (!head) return rest;
  return head + "；" + rest;
}

/**
 * The services in the list, in the order the file gives them. A service without a category (the table
 * of contents at the top of the file) and a link that points inside the file are not services.
 */
export function parseFreeForDev(markdown: string): FreebieEntry[] {
  const entries: FreebieEntry[] = [];
  let category = "";
  let current: FreebieEntry | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    // A first-level heading (the table of contents) ends the category.
    if (/^# /.test(line)) {
      category = "";
      current = null;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      category = heading[1].replace(/[*_`]/g, "").trim();
      current = null;
      continue;
    }
    const quota = QUOTA.exec(line);
    if (quota && current) {
      current.detail = join(current.detail, quota[1]);
      continue;
    }
    const service = SERVICE.exec(line);
    if (service) {
      const url = service[2].trim();
      if (!category || url.startsWith("#")) {
        current = null;
        continue;
      }
      current = { category, name: service[1].trim(), url, detail: plainText(service[3] ?? "") };
      entries.push(current);
      continue;
    }
    // A wrapped line under a service belongs to that service.
    if (/^ {3,}\S/.test(line) && current) {
      current.detail = join(current.detail, line.trim());
    }
  }
  return entries;
}
