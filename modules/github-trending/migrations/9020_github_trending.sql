-- The trending list GitHub shows for a period: one row per repository, the list's own order.
CREATE TABLE IF NOT EXISTS github_trending (
  period text NOT NULL,
  position integer NOT NULL,
  repo text NOT NULL,
  owner text NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  description text,
  language text,
  stars integer,
  forks integer,
  stars_period integer,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period, repo)
)