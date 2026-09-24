CREATE TABLE web_oauth_states (
  state_hash bytea PRIMARY KEY CHECK (octet_length(state_hash) = 32),
  code_verifier text NOT NULL CHECK (length(code_verifier) = 43),
  nonce text NOT NULL CHECK (length(nonce) = 43),
  expires_at timestamptz NOT NULL
);

CREATE INDEX web_oauth_states_expiry ON web_oauth_states (expires_at);
