-- What the free-for.dev repository itself says about itself: how many stars it has and
-- when it was last changed.
CREATE TABLE IF NOT EXISTS freebies_source (
  id integer PRIMARY KEY,
  stars integer,
  repo_updated_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
