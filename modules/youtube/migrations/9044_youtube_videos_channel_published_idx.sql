-- One channel's videos, newest first: what a channel page and a cycle read.
CREATE INDEX CONCURRENTLY IF NOT EXISTS youtube_videos_channel_published_idx ON youtube_videos (channel_id, published_at DESC);
