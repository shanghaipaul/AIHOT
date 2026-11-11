-- 这个视频的字幕查过了没有：查过就知道不用每轮都去问实例。
ALTER TABLE youtube_videos ADD COLUMN IF NOT EXISTS transcript_checked_at timestamptz;
