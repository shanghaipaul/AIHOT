// The runtime configuration the api publishes at /api/admin/config. The registry itself lives in
// the backend; the admin page only reads the entries it is handed. These shapes mirror the api
// contract (AdminConfigEntry) and belong in @aihot/contracts once the backend settles them.
export type AdminConfigType = "bool" | "int" | "string" | "enum";

/** Where the effective value comes from: the admin override, an environment variable, or the code default. */
export type AdminConfigSource = "admin" | "env" | "default";

export type AdminConfigValue = string | number | boolean | null;

export interface AdminConfigEntry {
  key: string;
  label: string;
  group: string;
  type: AdminConfigType;
  /** The allowed values of an `enum` entry. */
  options?: string[];
  /** The value the entry falls back to when nothing is set; absent when the entry has none. */
  default?: AdminConfigValue;
  description?: string;
  /** The change only takes effect after a restart. */
  restart?: boolean;
  /** The change can stop the engine; the save button turns red. */
  danger?: boolean;
  /** A secret: the api never sends the value back, only whether one is set. */
  secret?: boolean;
  /** The effective value (null for secrets). */
  value: AdminConfigValue;
  source: AdminConfigSource;
  /** Whether a secret has a value at all. */
  hasValue?: boolean;
}

export interface AdminConfigResponse {
  entries: AdminConfigEntry[];
}

/** What a write answers: the stored entry (the api may answer with the entry itself), or the reason it was refused. */
export interface AdminConfigWriteResult {
  ok?: boolean;
  entry?: AdminConfigEntry;
  error?: string;
}
