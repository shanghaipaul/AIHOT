// What the free tier list holds: one service that gives something away for free.
export interface FreebieItem {
  /** The group it belongs to, in Chinese ("模型 API"、"编程助手"…). */
  category: string;
  /** The service's own name. */
  name: string;
  /** Who gives it away (the curated list only; the collected list has no vendor of its own). */
  vendor: string;
  /** Where to get it. */
  url: string;
  /** What is free, in one line. */
  quota: string;
  /** The rest of the description. */
  detail: string;
  /** Where the entry came from. */
  source: "curated" | "free-for.dev";
}

/** The list as the page reads it. */
export interface FreebiesSnapshot {
  /** The hand-written list: the free tiers worth knowing about first. */
  curated: FreebieItem[];
  /** What free-for.dev lists, as it was last read. */
  dev: FreebieItem[];
  /** When that list was last read (null when it never was). */
  devFetchedAt: string | null;
  /** What the free-for.dev repository itself says about itself. */
  devSource: {
    repo: string;
    stars: number | null;
    updatedAt: string | null;
  };
}
