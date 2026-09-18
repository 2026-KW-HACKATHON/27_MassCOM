CREATE TABLE merchants (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  story text NOT NULL,
  road_address text NOT NULL CHECK (length(btrim(road_address)) > 0),
  minimum_spend_won integer NOT NULL CHECK (minimum_spend_won >= 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED')),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED')),
  is_public boolean NOT NULL DEFAULT false,
  enrollment_capacity integer NOT NULL CHECK (enrollment_capacity > 0),
  enrolled_count integer NOT NULL DEFAULT 0 CHECK (enrolled_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (enrolled_count <= enrollment_capacity)
);

CREATE UNIQUE INDEX campaigns_one_active_public_per_merchant
  ON campaigns (merchant_id)
  WHERE status = 'ACTIVE' AND is_public;

CREATE TABLE campaign_goals (
  campaign_id text NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  target_visit_count integer NOT NULL CHECK (target_visit_count IN (1, 3, 5)),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  PRIMARY KEY (campaign_id, target_visit_count)
);

CREATE INDEX campaigns_public_lookup
  ON campaigns (starts_at, ends_at, merchant_id)
  WHERE status = 'ACTIVE' AND is_public;
