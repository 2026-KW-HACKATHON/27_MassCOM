SET LOCAL lock_timeout = '5s';

ALTER TABLE public_rooms ADD COLUMN visibility text NOT NULL DEFAULT 'PRIVATE'
  CHECK (visibility IN ('PRIVATE', 'FRIENDS', 'NEIGHBORS'));
UPDATE public_rooms SET visibility = 'NEIGHBORS' WHERE visible;
CREATE INDEX public_rooms_neighbors_idx ON public_rooms (updated_at DESC,id) WHERE visibility = 'NEIGHBORS';
ALTER TABLE studios ADD COLUMN revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0);

CREATE TABLE furniture_catalog (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind = 'FURNITURE'),
  asset_id text,
  price_mileage integer CHECK (price_mileage >= 0),
  available boolean NOT NULL DEFAULT false
);
INSERT INTO furniture_catalog(id,name,kind,asset_id) VALUES
  ('oak-chair','오크 의자','FURNITURE','oak-chair'),
  ('round-table','원형 테이블','FURNITURE','round-table'),
  ('leafy-plant','잎 식물','FURNITURE','leafy-plant'),
  ('floor-lamp','플로어 램프','FURNITURE','floor-lamp'),
  ('bookcase','책장','FURNITURE','bookcase'),
  ('mushroom-lamp','버섯 램프','FURNITURE','mushroom-lamp');
CREATE TABLE furniture_inventory (
  id uuid PRIMARY KEY,
  account_id text NOT NULL,
  item_id text NOT NULL REFERENCES furniture_catalog(id),
  acquired_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX furniture_inventory_account_idx ON furniture_inventory(account_id);
CREATE TABLE furniture_purchases (
  account_id text NOT NULL,
  request_id text NOT NULL,
  item_id text NOT NULL REFERENCES furniture_catalog(id),
  inventory_id uuid NOT NULL UNIQUE REFERENCES furniture_inventory(id),
  price_mileage integer NOT NULL CHECK (price_mileage >= 0),
  PRIMARY KEY(account_id,request_id)
);
