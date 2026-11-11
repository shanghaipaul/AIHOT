-- 归档的字幕：原始 WebVTT 留一份，页面直接取用，不用每次都去问 invidious 实例。
CREATE TABLE IF NOT EXISTS youtube_subtitles (video_id text primary key, language text not null, provider text not null, fetched_at timestamptz not null default now(), content text not null);
