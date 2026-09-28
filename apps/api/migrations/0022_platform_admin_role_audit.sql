CREATE TABLE platform_admin_role_audit (
  id uuid PRIMARY KEY,
  target_account_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('GRANT', 'REVOKE')),
  db_user text NOT NULL DEFAULT session_user,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_admin_role_audit_target_time
  ON platform_admin_role_audit (target_account_id, created_at);
