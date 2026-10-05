ALTER TABLE mileage_spends
  ADD COLUMN bonus_mileage_amount integer NOT NULL DEFAULT 0 CHECK (bonus_mileage_amount >= 0),
  ADD COLUMN clothing_item_id text,
  ADD COLUMN clothing_awarded boolean NOT NULL DEFAULT false,
  ADD COLUMN clothing_duplicate boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT mileage_spends_clothing_reward_shape CHECK (
    (NOT clothing_awarded AND clothing_item_id IS NULL AND NOT clothing_duplicate)
    OR
    (clothing_awarded AND clothing_item_id IS NOT NULL)
  );

CREATE TABLE account_clothing (
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  item_id text NOT NULL CHECK (length(btrim(item_id)) > 0),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('REROLL')),
  PRIMARY KEY (account_id, item_id)
);

ALTER TABLE account_profile
  ADD COLUMN equipped_clothing_item_id text,
  ADD CONSTRAINT account_profile_equipped_clothing_fk
    FOREIGN KEY (account_id, equipped_clothing_item_id)
    REFERENCES account_clothing (account_id, item_id)
    ON DELETE SET NULL (equipped_clothing_item_id);
