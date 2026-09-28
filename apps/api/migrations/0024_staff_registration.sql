ALTER TABLE web_oauth_states DROP CONSTRAINT web_oauth_states_return_to_check;
ALTER TABLE web_oauth_states ADD CONSTRAINT web_oauth_states_return_to_check
  CHECK (return_to IN ('/app/', '/admin/', '/account-deletion', '/merchant/'));

CREATE TABLE staff_registration_requests (
  id uuid PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  account_id text NOT NULL,
  code_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX staff_registration_pending_account
  ON staff_registration_requests(account_id, merchant_id) WHERE consumed_at IS NULL;

CREATE TABLE staff_registration_audit (
  id uuid PRIMARY KEY,
  actor_account_id text NOT NULL,
  target_account_id text NOT NULL,
  merchant_id text NOT NULL REFERENCES merchants(id),
  action text NOT NULL CHECK (action IN ('APPROVED', 'REVOKED')),
  request_id uuid REFERENCES staff_registration_requests(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_registration_audit_merchant_time
  ON staff_registration_audit(merchant_id, created_at);
