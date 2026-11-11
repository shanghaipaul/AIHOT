-- What every collection of the X timeline did: what was found, what was new, what was left out.
CREATE TABLE IF NOT EXISTS x_timeline_runs (
  id         bigserial PRIMARY KEY,
  mode       text NOT NULL DEFAULT 'syndication',
  source_id  text NOT NULL,
  status     integer NOT NULL DEFAULT 0,
  found      integer NOT NULL DEFAULT 0,
  created    integer NOT NULL DEFAULT 0,
  skipped    integer NOT NULL DEFAULT 0,
  error      text,
  at         timestamptz NOT NULL DEFAULT now()
);
