-- One period's list, in its order.
CREATE INDEX CONCURRENTLY IF NOT EXISTS github_trending_period_position_idx ON github_trending (period, position)