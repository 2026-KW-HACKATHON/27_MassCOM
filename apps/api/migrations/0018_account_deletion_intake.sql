CREATE TABLE account_deletion_intake_requests (
  account_id text PRIMARY KEY CHECK (length(btrim(account_id)) > 0),
  requested_at timestamptz NOT NULL DEFAULT now()
);
