-- The channels the module watches: one row per channel, with the times it was last read.
CREATE TABLE IF NOT EXISTS youtube_channels (
  channel_id text PRIMARY KEY,
  handle text NOT NULL,
  title text NOT NULL,
  category text,
  enabled boolean NOT NULL DEFAULT true,
  last_fetched_at timestamptz,
  last_video_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
