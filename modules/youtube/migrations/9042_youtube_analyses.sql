-- What the model wrote about a video: the Chinese summary, its points and its topics.
CREATE TABLE IF NOT EXISTS youtube_analyses (
  video_id text PRIMARY KEY REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
  summary_zh text NOT NULL,
  key_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcript_hash text,
  model text,
  prompt_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
