CREATE TABLE auth_identities (
  provider text NOT NULL CHECK (provider = 'google'),
  subject text NOT NULL CHECK (length(btrim(subject)) > 0),
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  created_at timestamptz NOT NULL,
  CONSTRAINT auth_identities_provider_subject UNIQUE (provider, subject),
  CONSTRAINT auth_identities_account UNIQUE (account_id)
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_authenticated_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX auth_sessions_account_id ON auth_sessions (account_id);
