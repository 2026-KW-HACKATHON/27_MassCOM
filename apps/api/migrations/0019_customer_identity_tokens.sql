CREATE TABLE customer_identity_tokens (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  customer_account_id text NOT NULL CHECK (length(btrim(customer_account_id)) > 0),
  bound_merchant_id text REFERENCES merchants(id),
  bound_staff_account_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((bound_merchant_id IS NULL) = (bound_staff_account_id IS NULL))
);

CREATE INDEX customer_identity_tokens_account_idx
  ON customer_identity_tokens (customer_account_id);
