SET LOCAL lock_timeout = '5s';

ALTER TABLE collection_experience_profiles
  ADD COLUMN coin_source_kind text,
  ADD COLUMN coin_source_id uuid,
  ADD CONSTRAINT collection_experience_coin_source_pair CHECK (
    (coin_source_kind IS NULL AND coin_source_id IS NULL) OR
    (coin_source_kind IN ('VISIT','STORE_DRAW','GRADE_DRAW','REROLL') AND coin_source_id IS NOT NULL)
  );
