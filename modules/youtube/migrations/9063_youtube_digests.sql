-- 字幕精华提炼：把整段字幕换成一份格式化的中文提炼（结论、摘要、要点、关键数据、名词表、适合谁、注意事项）。
CREATE TABLE IF NOT EXISTS youtube_digests (
  video_id text PRIMARY KEY,
  channel_id text,
  title text,
  one_liner text,
  summary_zh text,
  key_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  audience text,
  caveats jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcript_hash text,
  model text,
  prompt_version text,
  status text NOT NULL DEFAULT 'pending',
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
