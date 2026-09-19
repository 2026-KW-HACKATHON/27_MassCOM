ALTER TABLE mint_jobs
  DROP CONSTRAINT mint_jobs_status_check;

ALTER TABLE mint_jobs
  ADD CONSTRAINT mint_jobs_status_check CHECK (
    status IN (
      'QUEUED', 'PREPARED', 'SUBMITTED', 'CONFIRMING', 'FINALIZED',
      'RETRYABLE', 'PAUSED', 'MANUAL_REVIEW', 'CANCELLED'
    )
  );

CREATE TABLE account_deletion_requests (
  id uuid PRIMARY KEY,
  account_reference_hash bytea NOT NULL UNIQUE CHECK (octet_length(account_reference_hash) = 32),
  deleted_account_alias text NOT NULL UNIQUE CHECK (
    deleted_account_alias ~ '^deleted:[0-9a-f]{64}$'
  ),
  status text NOT NULL CHECK (status IN ('WAITING_FOR_MINT_FINALITY', 'COMPLETED')),
  policy_version text NOT NULL CHECK (length(btrim(policy_version)) > 0),
  cancelled_mint_jobs integer NOT NULL CHECK (cancelled_mint_jobs >= 0),
  pending_mint_jobs integer NOT NULL CHECK (pending_mint_jobs >= 0),
  retained_finalized_nfts integer NOT NULL CHECK (retained_finalized_nfts >= 0),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL,
  CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL)
    OR (status = 'WAITING_FOR_MINT_FINALITY' AND completed_at IS NULL)
  )
);
