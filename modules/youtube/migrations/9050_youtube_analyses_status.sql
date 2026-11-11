-- 分析结果的状态：done 正常，blocked 是模型内容侧拒收（以后不再重试），failed 是临时故障（下一轮照常重试）。
ALTER TABLE youtube_analyses ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'done';
