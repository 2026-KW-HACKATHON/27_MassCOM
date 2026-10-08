-- Attribution for account-wide image generation limits. Final-stage actors cannot be inferred from old rounds.
ALTER TABLE ai_art_spend ADD COLUMN account_id text;
UPDATE ai_art_spend spend SET account_id = round.requested_by_account_id
  FROM merchant_art_rounds round
  WHERE spend.round_id = round.id AND spend.kind = 'DRAFT' AND round.requested_by_account_id IS NOT NULL;
CREATE INDEX ai_art_spend_account_created_idx ON ai_art_spend (account_id, created_at DESC)
  WHERE account_id IS NOT NULL;
