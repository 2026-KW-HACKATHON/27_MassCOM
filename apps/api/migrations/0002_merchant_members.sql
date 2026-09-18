CREATE TABLE merchant_members (
  merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  role text NOT NULL CHECK (role IN ('OWNER', 'STAFF')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, account_id),
  CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX merchant_members_active_account_lookup
  ON merchant_members (account_id, merchant_id)
  WHERE status = 'ACTIVE';
