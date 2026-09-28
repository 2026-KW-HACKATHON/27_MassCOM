CREATE TABLE platform_admins (
  account_id text PRIMARY KEY,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE platform_admin_audit (
  id uuid PRIMARY KEY,
  actor_account_id text NOT NULL,
  merchant_id text NOT NULL REFERENCES merchants(id),
  action text NOT NULL CHECK (action IN ('MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN')),
  before_state jsonb,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_admin_audit_merchant_time ON platform_admin_audit (merchant_id, created_at);
CREATE INDEX platform_admin_audit_actor ON platform_admin_audit (actor_account_id);

ALTER TABLE merchants ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
