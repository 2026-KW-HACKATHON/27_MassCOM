ALTER TABLE mint_jobs
  ADD COLUMN retry_streak integer NOT NULL DEFAULT 0 CHECK (retry_streak >= 0);
