ALTER TABLE web_oauth_states
  ADD COLUMN redirect_uri text NOT NULL
  DEFAULT 'https://masscom.kr/api/web/auth/callback'
  CHECK (redirect_uri IN (
    'https://masscom.kr/api/web/auth/callback',
    'https://www.masscom.kr/api/web/auth/callback'
  ));
