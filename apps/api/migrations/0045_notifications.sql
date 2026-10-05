-- Account-scoped inbox and per-device delivery. Push is opt-in; inbox is independent of OS permission.
CREATE TABLE notification_preferences (
  account_id text PRIMARY KEY,
  push_enabled boolean NOT NULL DEFAULT false,
  reward_available boolean NOT NULL DEFAULT true,
  coupon_expiring boolean NOT NULL DEFAULT true,
  campaign_expiring boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_devices (
  device_id uuid PRIMARY KEY,
  account_id text NOT NULL,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform = 'android'),
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_devices_account_idx ON notification_devices(account_id);

CREATE TABLE notification_items (
  id uuid PRIMARY KEY,
  account_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('REWARD_AVAILABLE', 'COUPON_EXPIRING', 'CAMPAIGN_EXPIRING')),
  dedupe_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  target_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (account_id, dedupe_key)
);
CREATE INDEX notification_items_account_idx ON notification_items(account_id, created_at DESC);
CREATE INDEX notification_items_retention_idx ON notification_items(created_at, id);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notification_items(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES notification_devices(device_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'LEASED', 'SENT', 'FAILED')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  due_at timestamptz NOT NULL DEFAULT now(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  UNIQUE (notification_id, device_id),
  CHECK ((status = 'LEASED') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX notification_deliveries_due_idx ON notification_deliveries(due_at, id)
  WHERE status IN ('PENDING', 'LEASED');
