// The X account the timeline follows: how the configuration writes the name, how the collector
// reads it, and how two names are compared. Pure functions, so the page, the api and the tests all
// say the same thing about one account.

// The X username without the @ and without the spaces around it.
export function normalizeHandle(handle: string | null | undefined): string {
  return String(handle ?? "").trim().replace(/^@+/, "").trim();
}

// The same account for comparison: X usernames do not care about the case.
export function handleKey(handle: string | null | undefined): string {
  return normalizeHandle(handle).toLowerCase();
}

// The query the engine's x_search collector reads: the account's own posts, without the replies
// unless the configuration asks for them.
export function buildXQuery(handle: string | null | undefined, includeReplies: boolean): string {
  const name = normalizeHandle(handle);
  if (!name) return "";
  return includeReplies ? "from:" + name : "from:" + name + " -filter:replies";
}

// The account a query names, when it names one.
export function handleFromQuery(query: string | null | undefined): string | null {
  const found = /from:([A-Za-z0-9_]{1,15})/i.exec(String(query ?? ""));
  return found ? found[1] : null;
}
