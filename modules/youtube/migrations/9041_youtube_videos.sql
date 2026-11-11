-- The videos found in those channels: one row per video, with the transcript when one was found.
CREATE TABLE IF NOT EXISTS youtube_videos (
  video_id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES youtube_channels(channel_id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  description text,
  duration_seconds integer,
  view_count integer,
  published_at timestamptz,
  thumbnail text,
  transcript text,
  transcript_source text,
  transcript_lang text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
