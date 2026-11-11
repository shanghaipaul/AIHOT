-- The newest video first: the list the page shows, and the videos a cycle reads first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS youtube_videos_published_at_idx ON youtube_videos (published_at DESC);
