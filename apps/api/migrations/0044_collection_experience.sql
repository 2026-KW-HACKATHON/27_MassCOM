-- Personal display choices. Rewards remain derived from the authoritative visit, play and draw ledgers.
CREATE TABLE collection_experience_profiles (
  account_id text PRIMARY KEY CHECK (length(btrim(account_id)) > 0),
  badge_id text,
  cosmetics jsonb NOT NULL DEFAULT '{"hat":null,"bag":null,"prop":null,"pose":null,"decor":null}'::jsonb,
  coin_entitlement_id uuid,
  wishlist_item_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_experience_cosmetics_object CHECK (jsonb_typeof(cosmetics) = 'object'),
  CONSTRAINT collection_experience_coin_fk FOREIGN KEY (coin_entitlement_id)
    REFERENCES reward_entitlements(id) ON DELETE SET NULL
);
CREATE INDEX collection_experience_coin_lookup ON collection_experience_profiles (coin_entitlement_id)
  WHERE coin_entitlement_id IS NOT NULL;
