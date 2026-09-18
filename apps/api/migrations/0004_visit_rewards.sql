ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_id_merchant_unique UNIQUE (id, merchant_id);

CREATE TABLE visit_events (
  id uuid PRIMARY KEY,
  claim_slot_id uuid NOT NULL UNIQUE REFERENCES claim_slots(id),
  merchant_id text NOT NULL REFERENCES merchants(id),
  campaign_id text NOT NULL,
  customer_account_id text NOT NULL CHECK (length(btrim(customer_account_id)) > 0),
  occurred_at timestamptz NOT NULL,
  business_date date NOT NULL,
  verification_level text NOT NULL CHECK (verification_level IN ('MERCHANT_CONFIRMED', 'POS_VERIFIED')),
  status text NOT NULL CHECK (status IN ('VALID', 'CANCELED')),
  progress_counted boolean NOT NULL,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, merchant_id)
    REFERENCES campaigns(id, merchant_id),
  CHECK (
    (status = 'VALID' AND cancellation_reason IS NULL)
    OR (status = 'CANCELED' AND length(btrim(cancellation_reason)) > 0)
  )
);

CREATE UNIQUE INDEX visit_events_daily_progress_unique
  ON visit_events (customer_account_id, merchant_id, business_date)
  WHERE status = 'VALID' AND progress_counted;

CREATE INDEX visit_events_campaign_progress_lookup
  ON visit_events (customer_account_id, campaign_id, occurred_at)
  WHERE status = 'VALID' AND progress_counted;

CREATE TABLE reward_entitlements (
  id uuid PRIMARY KEY,
  customer_account_id text NOT NULL CHECK (length(btrim(customer_account_id)) > 0),
  campaign_id text NOT NULL,
  target_visit_count integer NOT NULL,
  source_visit_event_id uuid NOT NULL REFERENCES visit_events(id),
  status text NOT NULL CHECK (status IN ('GRANTED', 'CANCELED', 'MINT_REQUESTED', 'FULFILLED')),
  policy_version text NOT NULL CHECK (length(btrim(policy_version)) > 0),
  earned_at timestamptz NOT NULL,
  claim_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, target_visit_count)
    REFERENCES campaign_goals(campaign_id, target_visit_count),
  CONSTRAINT reward_entitlements_unique_goal
    UNIQUE (customer_account_id, campaign_id, target_visit_count),
  CHECK (claim_expires_at > earned_at)
);

CREATE INDEX reward_entitlements_owner_status_lookup
  ON reward_entitlements (customer_account_id, status, claim_expires_at);
