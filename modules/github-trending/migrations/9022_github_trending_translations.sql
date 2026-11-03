-- The Chinese description of a repository: the model writes it once. The English text it
-- translated is kept beside it, so a repository whose description on GitHub changed is translated
-- again and one whose description stayed is not.
CREATE TABLE IF NOT EXISTS github_trending_zh (
  repo text PRIMARY KEY,
  description text NOT NULL,
  zh text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);