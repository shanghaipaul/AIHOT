-- youtube_subtitles 里再存一份去掉时间轴的纯文本：用户直接读、直接复制，不用再解析 vtt。
ALTER TABLE youtube_subtitles ADD COLUMN IF NOT EXISTS content_text text;
