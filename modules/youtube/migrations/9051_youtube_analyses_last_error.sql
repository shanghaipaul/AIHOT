-- 分析失败时留一句原因，方便在库里直接看出卡在哪。
ALTER TABLE youtube_analyses ADD COLUMN IF NOT EXISTS last_error text;
