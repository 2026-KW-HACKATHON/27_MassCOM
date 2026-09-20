ALTER TABLE mint_tx_attempts
  ADD COLUMN signed_transaction text CHECK (
    signed_transaction IS NULL OR signed_transaction ~ '^0x[0-9a-f]+$'
  );
