CREATE TABLE campaign_enrollments (
  id uuid PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES campaigns(id),
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  enrolled_at timestamptz NOT NULL,
  CONSTRAINT campaign_enrollments_unique_account UNIQUE (campaign_id, account_id)
);

CREATE INDEX campaign_enrollments_account_lookup ON campaign_enrollments (account_id);
