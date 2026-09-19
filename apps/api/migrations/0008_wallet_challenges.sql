CREATE TABLE wallet_challenges (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  address text NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  chain_id integer NOT NULL CHECK (chain_id > 0),
  nonce text NOT NULL CHECK (length(btrim(nonce)) > 0),
  message text NOT NULL CHECK (length(btrim(message)) > 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'verifying', 'used'))
);

CREATE INDEX wallet_challenges_account_id ON wallet_challenges (account_id);
CREATE INDEX wallet_challenges_expires_at ON wallet_challenges (expires_at);
