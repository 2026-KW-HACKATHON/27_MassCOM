SET LOCAL lock_timeout = '5s';

CREATE TABLE merchant_real_world_profiles (
  merchant_id text PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
  latitude double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude BETWEEN -180 AND 180),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK ((profile->'location' = 'null'::jsonb AND latitude IS NULL) OR
         (latitude = (profile #>> '{location,building,latitude}')::double precision AND
          longitude = (profile #>> '{location,building,longitude}')::double precision))
);

CREATE INDEX merchant_real_world_coordinates
  ON merchant_real_world_profiles (longitude, latitude)
  WHERE longitude IS NOT NULL;

CREATE INDEX merchants_real_world_public_order
  ON merchants (name, id)
  WHERE status = 'ACTIVE' AND published_at IS NOT NULL;
