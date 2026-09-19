CREATE TABLE wallet_bindings (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  address_checksum text NOT NULL CHECK (address_checksum ~ '^0x[0-9a-fA-F]{40}$'),
  address_normalized text NOT NULL CHECK (
    address_normalized ~ '^0x[0-9a-f]{40}$'
    AND address_normalized = lower(address_normalized)
  ),
  chain_id integer NOT NULL CHECK (chain_id > 0),
  binding_version integer NOT NULL CHECK (binding_version > 0),
  status text NOT NULL CHECK (status IN ('VERIFIED', 'DISCONNECTED')),
  verified_at timestamptz NOT NULL,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, binding_version),
  UNIQUE (id, binding_version),
  CHECK (
    (status = 'VERIFIED' AND disconnected_at IS NULL)
    OR (status = 'DISCONNECTED' AND disconnected_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX wallet_bindings_one_active_per_account
  ON wallet_bindings (account_id)
  WHERE status = 'VERIFIED';

CREATE UNIQUE INDEX wallet_bindings_one_active_per_address
  ON wallet_bindings (address_normalized, chain_id)
  WHERE status = 'VERIFIED';

CREATE TABLE nft_series (
  id text PRIMARY KEY CHECK (length(btrim(id)) > 0),
  campaign_id text NOT NULL,
  target_visit_count integer NOT NULL,
  chain_id integer NOT NULL CHECK (chain_id > 0),
  contract_address text NOT NULL CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  contract_address_normalized text NOT NULL CHECK (
    contract_address_normalized ~ '^0x[0-9a-f]{40}$'
    AND contract_address_normalized = lower(contract_address_normalized)
  ),
  series_key bytea NOT NULL CHECK (octet_length(series_key) = 32),
  max_ever_minted integer NOT NULL CHECK (max_ever_minted > 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, target_visit_count)
    REFERENCES campaign_goals(campaign_id, target_visit_count),
  UNIQUE (campaign_id, target_visit_count),
  UNIQUE (chain_id, contract_address_normalized, series_key)
);

CREATE TABLE mint_jobs (
  id uuid PRIMARY KEY,
  entitlement_id uuid NOT NULL UNIQUE REFERENCES reward_entitlements(id),
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  nft_series_id text NOT NULL REFERENCES nft_series(id),
  reward_key bytea NOT NULL UNIQUE CHECK (octet_length(reward_key) = 32),
  wallet_binding_id uuid NOT NULL,
  binding_version integer NOT NULL CHECK (binding_version > 0),
  recipient_address text NOT NULL CHECK (recipient_address ~ '^0x[0-9a-fA-F]{40}$'),
  recipient_address_normalized text NOT NULL CHECK (
    recipient_address_normalized ~ '^0x[0-9a-f]{40}$'
    AND recipient_address_normalized = lower(recipient_address_normalized)
  ),
  chain_id integer NOT NULL CHECK (chain_id > 0),
  contract_address text NOT NULL CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  contract_address_normalized text NOT NULL CHECK (
    contract_address_normalized ~ '^0x[0-9a-f]{40}$'
    AND contract_address_normalized = lower(contract_address_normalized)
  ),
  series_key bytea NOT NULL CHECK (octet_length(series_key) = 32),
  consent_version text NOT NULL CHECK (length(btrim(consent_version)) > 0),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_fingerprint bytea NOT NULL CHECK (octet_length(request_fingerprint) = 32),
  status text NOT NULL CHECK (
    status IN (
      'QUEUED', 'PREPARED', 'SUBMITTED', 'CONFIRMING', 'FINALIZED',
      'RETRYABLE', 'PAUSED', 'MANUAL_REVIEW'
    )
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (wallet_binding_id, binding_version)
    REFERENCES wallet_bindings(id, binding_version),
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX mint_jobs_series_supply_lookup
  ON mint_jobs (nft_series_id, status);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL CHECK (aggregate_type = 'MINT_JOB'),
  aggregate_id uuid NOT NULL REFERENCES mint_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type = 'MINT_REQUESTED'),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'LEASED', 'PUBLISHED')),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (aggregate_type, aggregate_id, event_type),
  CHECK (
    (status = 'LEASED' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'LEASED' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX outbox_events_pending_lookup
  ON outbox_events (status, available_at, created_at);
