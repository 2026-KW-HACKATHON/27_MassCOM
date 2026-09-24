ALTER TABLE web_sessions
  ADD COLUMN origin_host text NOT NULL DEFAULT 'masscom.kr'
  CHECK (origin_host IN ('masscom.kr', 'www.masscom.kr'));
