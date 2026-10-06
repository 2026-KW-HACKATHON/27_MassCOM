SET LOCAL lock_timeout = '5s';

CREATE TABLE merchant_real_world_media (
  digest text PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  image_bytes bytea NOT NULL CHECK (octet_length(image_bytes) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merchant_real_world_photos (
  id uuid PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  digest text NOT NULL REFERENCES merchant_real_world_media(digest),
  mime_type text NOT NULL DEFAULT 'image/webp' CHECK (mime_type = 'image/webp'),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  kind text NOT NULL CHECK (kind IN ('STORE', 'MENU', 'ENTRANCE', 'PACKAGING', 'SIGN')),
  caption text CHECK (caption IS NULL OR length(caption) <= 300),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merchant_real_world_photos_active ON merchant_real_world_photos (merchant_id, created_at, id)
  WHERE deleted_at IS NULL;
CREATE INDEX merchant_real_world_photos_public_digest ON merchant_real_world_photos (digest)
  WHERE deleted_at IS NULL;

CREATE TABLE merchant_real_world_reports (
  id uuid PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  reporter_account_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('LOCATION', 'HOURS', 'PHOTO', 'OTHER')),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'REJECTED')),
  resolution text CHECK (resolution IS NULL OR length(resolution) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX merchant_real_world_reports_merchant ON merchant_real_world_reports (merchant_id, created_at DESC);
CREATE INDEX merchant_real_world_reports_reporter ON merchant_real_world_reports (reporter_account_id);
