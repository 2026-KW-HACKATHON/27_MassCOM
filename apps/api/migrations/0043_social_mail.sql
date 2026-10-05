-- Social mail, friendship gifts, mileage credit ledger, and notification outbox.
-- Additive only. Account deletion cleanup is wired by the root-owned deletion service.
CREATE TABLE mileage_credits (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  amount integer NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (reason IN ('FRIENDSHIP', 'DRAW_BONUS')),
  source_id text NOT NULL CHECK (length(btrim(source_id)) > 0),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mileage_credits_account_reason_source_unique UNIQUE (account_id, reason, source_id)
);

CREATE INDEX mileage_credits_account_reason_date_idx
  ON mileage_credits (account_id, reason, business_date);
CREATE INDEX mileage_credits_account_created_idx
  ON mileage_credits (account_id, created_at);

CREATE TABLE friendship_gifts (
  id uuid PRIMARY KEY,
  friendship_id uuid NOT NULL,
  sender_account_id text NOT NULL CHECK (length(btrim(sender_account_id)) > 0),
  receiver_account_id text NOT NULL CHECK (length(btrim(receiver_account_id)) > 0),
  sender_request_id text NOT NULL CHECK (length(btrim(sender_request_id)) > 0),
  receiver_request_id text,
  sent_business_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'RECEIVED')),
  sender_reward_amount integer NOT NULL DEFAULT 0 CHECK (sender_reward_amount >= 0),
  receiver_reward_amount integer NOT NULL DEFAULT 0 CHECK (receiver_reward_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  CONSTRAINT friendship_gifts_distinct_accounts CHECK (sender_account_id <> receiver_account_id),
  CONSTRAINT friendship_gifts_sender_request_unique UNIQUE (sender_account_id, sender_request_id)
);

CREATE UNIQUE INDEX friendship_gifts_receiver_request_unique
  ON friendship_gifts (receiver_account_id, receiver_request_id)
  WHERE receiver_request_id IS NOT NULL;
CREATE UNIQUE INDEX friendship_gifts_pending_pair_unique
  ON friendship_gifts (friendship_id, sender_account_id, receiver_account_id)
  WHERE status = 'PENDING';
CREATE INDEX friendship_gifts_sender_date_idx
  ON friendship_gifts (sender_account_id, sent_business_date);
CREATE INDEX friendship_gifts_receiver_pending_idx
  ON friendship_gifts (receiver_account_id, status, created_at);
CREATE INDEX friendship_gifts_friendship_idx
  ON friendship_gifts (friendship_id, created_at);

CREATE TABLE social_mail (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('MESSAGE', 'MEAL_INVITATION', 'MEAL_RESPONSE', 'FRIENDSHIP_GIFT')),
  sender_account_id text,
  receiver_account_id text NOT NULL CHECK (length(btrim(receiver_account_id)) > 0),
  friendship_id uuid,
  request_id text,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  body text NOT NULL CHECK (char_length(body) <= 500),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX social_mail_sender_request_unique
  ON social_mail (sender_account_id, request_id)
  WHERE sender_account_id IS NOT NULL AND request_id IS NOT NULL;
CREATE INDEX social_mail_receiver_created_idx
  ON social_mail (receiver_account_id, created_at DESC, id DESC);
CREATE INDEX social_mail_sender_created_idx
  ON social_mail (sender_account_id, created_at DESC, id DESC)
  WHERE sender_account_id IS NOT NULL;

CREATE TABLE meal_invitations (
  id uuid PRIMARY KEY,
  friendship_id uuid NOT NULL,
  sender_account_id text NOT NULL CHECK (length(btrim(sender_account_id)) > 0),
  receiver_account_id text NOT NULL CHECK (length(btrim(receiver_account_id)) > 0),
  request_id text NOT NULL CHECK (length(btrim(request_id)) > 0),
  merchant_id text NOT NULL CHECK (length(btrim(merchant_id)) > 0),
  merchant_name text NOT NULL CHECK (char_length(btrim(merchant_name)) > 0),
  merchant_address text NOT NULL CHECK (char_length(btrim(merchant_address)) > 0),
  invite_date date NOT NULL,
  schedule_kind text NOT NULL CHECK (schedule_kind IN ('CONFIRMED', 'RANGE')),
  confirmed_time text,
  range_start_time text,
  range_end_time text,
  status text NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED')),
  selected_time text,
  response_request_id text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meal_invitations_distinct_accounts CHECK (sender_account_id <> receiver_account_id),
  CONSTRAINT meal_invitations_sender_request_unique UNIQUE (sender_account_id, request_id),
  CONSTRAINT meal_invitations_confirmed_shape CHECK (
    (schedule_kind = 'CONFIRMED' AND confirmed_time IS NOT NULL AND range_start_time IS NULL AND range_end_time IS NULL)
    OR
    (schedule_kind = 'RANGE' AND confirmed_time IS NULL AND range_start_time IS NOT NULL AND range_end_time IS NOT NULL)
  )
);

CREATE UNIQUE INDEX meal_invitations_receiver_response_request_unique
  ON meal_invitations (receiver_account_id, response_request_id)
  WHERE response_request_id IS NOT NULL;
CREATE INDEX meal_invitations_receiver_status_idx
  ON meal_invitations (receiver_account_id, status, created_at);
CREATE INDEX meal_invitations_friendship_idx
  ON meal_invitations (friendship_id, created_at);

CREATE TABLE push_tokens (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  app_variant text NOT NULL CHECK (app_variant IN ('ANDROID', 'SHOWCASE_APP')),
  token text NOT NULL CHECK (length(btrim(token)) > 0),
  device_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT push_tokens_account_variant_token_unique UNIQUE (account_id, app_variant, token)
);

CREATE INDEX push_tokens_token_lookup_idx ON push_tokens (token) WHERE revoked_at IS NULL;
CREATE INDEX push_tokens_account_active_idx ON push_tokens (account_id, app_variant) WHERE revoked_at IS NULL;

CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  mail_id uuid,
  event_type text NOT NULL CHECK (length(btrim(event_type)) > 0),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'AWAITING_RECEIPT', 'RETRY', 'SENT', 'DEAD', 'CANCELLED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_id text,
  lease_expires_at timestamptz,
  expo_ticket_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_outbox_due_idx
  ON notification_outbox (status, next_attempt_at, created_at);
CREATE INDEX notification_outbox_receipt_idx
  ON notification_outbox (status, expo_ticket_id, updated_at)
  WHERE expo_ticket_id IS NOT NULL;
CREATE INDEX notification_outbox_account_idx
  ON notification_outbox (account_id, created_at);
