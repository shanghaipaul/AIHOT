// What the trending list holds: one repository and its place in the list, for one period.
export type TrendingPeriod = "daily" | "weekly" | "monthly";

export const TRENDING_PERIODS: readonly TrendingPeriod[] = ["daily", "weekly", "monthly"];

/** The period an address asks for; anything else is the daily list. */
export function readPeriod(value: unknown): TrendingPeriod {
  return TRENDING_PERIODS.includes(value as TrendingPeriod) ? (value as TrendingPeriod) : "daily";
}

export interface TrendingRepo {
  /** Its place in the list, from 1. */
  rank: number;
  /** "owner/name". */
  repo: string;
  owner: string;
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  forks: number | null;
  /** The stars the repository gained in the period, as GitHub counts them. */
  starsPeriod: number | null;
}

export interface TrendingSnapshot {
  period: TrendingPeriod;
  /** When the list was read from GitHub (null when it never was). */
  fetchedAt: string | null;
  repos: TrendingRepo[];
}