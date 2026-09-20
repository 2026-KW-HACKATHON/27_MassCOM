-- Even-length lowercase hex only (a well-formed byte string can never have an odd number of hex
-- digits), with a generous but explicit length bound (2 + 16384 hex digits = 8 KiB of raw
-- transaction bytes) so one malformed or malicious value cannot grow this column unbounded.
ALTER TABLE mint_tx_attempts
  ADD COLUMN signed_transaction text CHECK (
    signed_transaction IS NULL OR (
      signed_transaction ~ '^0x([0-9a-f]{2})+$'
      AND length(signed_transaction) <= 16386
    )
  );
