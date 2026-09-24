CREATE TABLE web_sessions (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX web_sessions_account_active
  ON web_sessions (account_id, expires_at)
  WHERE revoked_at IS NULL;
