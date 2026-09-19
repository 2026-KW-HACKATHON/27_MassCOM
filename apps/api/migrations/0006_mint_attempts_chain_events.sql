ALTER TABLE mint_jobs
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN transaction_hash text CHECK (
    transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'
  ),
  ADD COLUMN token_id numeric(78, 0) CHECK (token_id IS NULL OR token_id >= 0),
  ADD COLUMN last_error_code text,
  ADD COLUMN finalized_at timestamptz;

CREATE TABLE mint_tx_attempts (
  id uuid PRIMARY KEY,
  mint_job_id uuid NOT NULL REFERENCES mint_jobs(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL CHECK (status IN ('PREPARED', 'SUBMITTED', 'MINED', 'FAILED')),
  transaction_hash text UNIQUE CHECK (
    transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'
  ),
  error_code text,
  prepared_at timestamptz NOT NULL,
  submitted_at timestamptz,
  mined_at timestamptz,
  updated_at timestamptz NOT NULL,
  UNIQUE (mint_job_id, attempt_number)
);

CREATE TABLE chain_events (
  id uuid PRIMARY KEY,
  chain_id integer NOT NULL CHECK (chain_id > 0),
  contract_address_normalized text NOT NULL CHECK (
    contract_address_normalized ~ '^0x[0-9a-f]{40}$'
    AND contract_address_normalized = lower(contract_address_normalized)
  ),
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer NOT NULL CHECK (log_index >= 0),
  block_number bigint NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  reward_key bytea NOT NULL CHECK (octet_length(reward_key) = 32),
  series_key bytea NOT NULL CHECK (octet_length(series_key) = 32),
  recipient_address_normalized text NOT NULL CHECK (
    recipient_address_normalized ~ '^0x[0-9a-f]{40}$'
    AND recipient_address_normalized = lower(recipient_address_normalized)
  ),
  token_id numeric(78, 0) NOT NULL CHECK (token_id >= 0),
  status text NOT NULL CHECK (status IN ('OBSERVED', 'FINALIZED', 'ORPHANED')),
  observed_at timestamptz NOT NULL,
  finalized_at timestamptz,
  UNIQUE (chain_id, transaction_hash, log_index),
  UNIQUE (chain_id, contract_address_normalized, reward_key)
);

CREATE TABLE nft_assets (
  id uuid PRIMARY KEY,
  mint_job_id uuid NOT NULL UNIQUE REFERENCES mint_jobs(id),
  chain_event_id uuid NOT NULL UNIQUE REFERENCES chain_events(id),
  chain_id integer NOT NULL CHECK (chain_id > 0),
  contract_address text NOT NULL CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  contract_address_normalized text NOT NULL CHECK (
    contract_address_normalized ~ '^0x[0-9a-f]{40}$'
    AND contract_address_normalized = lower(contract_address_normalized)
  ),
  token_id numeric(78, 0) NOT NULL CHECK (token_id >= 0),
  reward_key bytea NOT NULL UNIQUE CHECK (octet_length(reward_key) = 32),
  recipient_address text NOT NULL CHECK (recipient_address ~ '^0x[0-9a-fA-F]{40}$'),
  recipient_address_normalized text NOT NULL CHECK (
    recipient_address_normalized ~ '^0x[0-9a-f]{40}$'
    AND recipient_address_normalized = lower(recipient_address_normalized)
  ),
  finalized_at timestamptz NOT NULL,
  UNIQUE (chain_id, contract_address_normalized, token_id)
);

CREATE TABLE chain_cursors (
  chain_id integer NOT NULL CHECK (chain_id > 0),
  contract_address_normalized text NOT NULL CHECK (
    contract_address_normalized ~ '^0x[0-9a-f]{40}$'
    AND contract_address_normalized = lower(contract_address_normalized)
  ),
  next_block bigint NOT NULL CHECK (next_block >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (chain_id, contract_address_normalized)
);
