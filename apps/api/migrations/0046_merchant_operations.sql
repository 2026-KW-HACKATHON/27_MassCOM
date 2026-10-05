-- Merchant-owned campaign renewal and staff actions have their own immutable audit trail.
SET LOCAL lock_timeout = '5s';

ALTER TABLE merchant_members
  ADD COLUMN staff_can_confirm_visit boolean NOT NULL DEFAULT true,
  ADD COLUMN staff_can_redeem_coupon boolean NOT NULL DEFAULT true;

CREATE TABLE merchant_campaign_extension_audit (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  merchant_id text NOT NULL REFERENCES merchants(id),
  campaign_id text NOT NULL REFERENCES campaigns(id),
  actor_account_id text NOT NULL,
  previous_ends_at timestamptz NOT NULL,
  new_ends_at timestamptz NOT NULL,
  days smallint NOT NULL CHECK (days IN (30, 90)),
  consent_accepted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (new_ends_at > previous_ends_at)
);
CREATE INDEX merchant_campaign_extension_audit_merchant_time
  ON merchant_campaign_extension_audit (merchant_id, created_at DESC);

CREATE TABLE merchant_staff_action_audit (
  id uuid PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  actor_account_id text NOT NULL,
  target_account_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('APPROVED', 'PERMISSIONS_CHANGED', 'REVOKED')),
  request_id uuid REFERENCES staff_registration_requests(id) ON DELETE SET NULL,
  before_permissions jsonb,
  after_permissions jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merchant_staff_action_audit_merchant_time
  ON merchant_staff_action_audit (merchant_id, created_at DESC);

CREATE INDEX visit_events_merchant_business_date_export
  ON visit_events (merchant_id, business_date, occurred_at, id);
