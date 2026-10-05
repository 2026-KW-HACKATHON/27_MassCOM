-- Per-token push delivery durability and lease fencing for social notifications.
-- 0043 may already be applied in QA, so this forward migration upgrades both existing and fresh databases.

ALTER TABLE notification_outbox
  ADD COLUMN IF NOT EXISTS lease_generation integer NOT NULL DEFAULT 0 CHECK (lease_generation >= 0);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY,
  outbox_id uuid NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  app_variant text NOT NULL CHECK (app_variant IN ('ANDROID', 'SHOWCASE_APP')),
  token text NOT NULL CHECK (length(btrim(token)) > 0),
  status text NOT NULL CHECK (status IN ('PROCESSING', 'AWAITING_RECEIPT', 'RETRY', 'SENT', 'DEAD', 'CANCELLED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_id text,
  lease_generation integer NOT NULL CHECK (lease_generation >= 0),
  lease_expires_at timestamptz,
  expo_ticket_id text,
  last_error_code text,
  authorized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_deliveries_outbox_status_idx
  ON notification_deliveries (outbox_id, status, next_attempt_at);
CREATE INDEX notification_deliveries_receipt_idx
  ON notification_deliveries (status, expo_ticket_id, updated_at)
  WHERE expo_ticket_id IS NOT NULL;
CREATE INDEX notification_deliveries_account_token_idx
  ON notification_deliveries (account_id, app_variant, token, created_at);

WITH ranked_active_tokens AS (
  SELECT id,
         row_number() OVER (PARTITION BY app_variant, token ORDER BY updated_at DESC, id DESC) AS keep_rank
  FROM push_tokens
  WHERE revoked_at IS NULL
)
UPDATE push_tokens token
SET revoked_at = coalesce(token.revoked_at, now()), updated_at = now()
FROM ranked_active_tokens ranked
WHERE token.id = ranked.id AND ranked.keep_rank > 1;

CREATE UNIQUE INDEX push_tokens_active_variant_token_unique
  ON push_tokens (app_variant, token)
  WHERE revoked_at IS NULL;

-- Forward-upgrade existing 0043-0045 outbox rows into safe per-token legacy rows.
-- The legacy token is intentionally synthetic, so old receipt dead-token results cannot revoke every account token.
INSERT INTO notification_deliveries (
  id, outbox_id, account_id, app_variant, token, status, attempts, next_attempt_at,
  lease_id, lease_generation, lease_expires_at, expo_ticket_id, last_error_code,
  authorized_at, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  outbox.id,
  outbox.account_id,
  'ANDROID',
  'legacy:' || outbox.id::text,
  CASE
    WHEN outbox.status = 'PROCESSING' AND outbox.lease_expires_at <= now() THEN 'RETRY'
    ELSE outbox.status
  END,
  outbox.attempts,
  outbox.next_attempt_at,
  CASE
    WHEN outbox.status = 'PROCESSING' AND outbox.lease_expires_at > now() THEN outbox.lease_id
    ELSE NULL
  END,
  outbox.lease_generation,
  CASE
    WHEN outbox.status = 'PROCESSING' AND outbox.lease_expires_at > now() THEN outbox.lease_expires_at
    ELSE NULL
  END,
  outbox.expo_ticket_id,
  outbox.last_error_code,
  CASE
    WHEN outbox.status IN ('PROCESSING', 'AWAITING_RECEIPT', 'SENT') THEN outbox.updated_at
    ELSE NULL
  END,
  outbox.created_at,
  outbox.updated_at
FROM notification_outbox outbox
WHERE outbox.status IN ('PROCESSING', 'AWAITING_RECEIPT', 'RETRY', 'SENT', 'DEAD', 'CANCELLED')
  AND NOT EXISTS (
    SELECT 1 FROM notification_deliveries delivery WHERE delivery.outbox_id = outbox.id
  );
