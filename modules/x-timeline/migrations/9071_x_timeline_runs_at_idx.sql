-- The newest run is what the page shows, so the rows are read newest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS x_timeline_runs_at_idx ON x_timeline_runs (at DESC);
