-- The free developer tiers free-for.dev lists: one row per service, in the list's own order.
CREATE TABLE IF NOT EXISTS freebies_dev (
  position integer PRIMARY KEY,
  category text NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  detail text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
