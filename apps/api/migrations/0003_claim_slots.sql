CREATE TABLE claim_slots (
  id uuid PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_account_id text NOT NULL CHECK (length(btrim(customer_account_id)) > 0),
  merchant_reference_hash bytea NOT NULL CHECK (octet_length(merchant_reference_hash) = 32),
  created_by_account_id text NOT NULL,
  token_hash bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  token_version integer NOT NULL DEFAULT 1 CHECK (token_version > 0),
  status text NOT NULL CHECK (status IN ('ISSUED', 'CLAIMED', 'EXPIRED', 'REVOKED')),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant_id, created_by_account_id)
    REFERENCES merchant_members(merchant_id, account_id),
  CONSTRAINT claim_slots_unique_token UNIQUE (token_hash),
  CONSTRAINT claim_slots_unique_reference
    UNIQUE (merchant_id, customer_account_id, merchant_reference_hash),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'CLAIMED' AND claimed_at IS NOT NULL)
    OR (status <> 'CLAIMED' AND claimed_at IS NULL)
  )
);

CREATE INDEX claim_slots_merchant_status_lookup
  ON claim_slots (merchant_id, status, expires_at);
