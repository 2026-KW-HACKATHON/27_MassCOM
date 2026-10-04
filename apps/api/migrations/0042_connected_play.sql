CREATE TABLE play_runs (
  id uuid PRIMARY KEY,
  account_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('stack', 'memory', 'delivery', 'orders')),
  seed integer NOT NULL CHECK (seed BETWEEN 0 AND 2147483647),
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  rules_version integer NOT NULL CHECK (rules_version = 1),
  finished_at timestamptz,
  result jsonb,
  CHECK ((finished_at IS NULL) = (result IS NULL))
);
CREATE INDEX play_runs_account_started_idx ON play_runs (account_id, started_at DESC);

CREATE TABLE play_records (
  account_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('stack', 'memory', 'delivery', 'orders')),
  best_score integer NOT NULL CHECK (best_score >= 0),
  plays integer NOT NULL CHECK (plays >= 0),
  PRIMARY KEY (account_id, kind)
);

CREATE TABLE studios (
  account_id text PRIMARY KEY,
  studio jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Counts contain no account, friendship, entitlement, or device identifiers.
CREATE TABLE play_flow_counts (
  event_date date NOT NULL,
  event text NOT NULL CHECK (event IN ('start', 'complete', 'studio-save', 'share-open', 'image-created')),
  kind text NOT NULL DEFAULT 'all' CHECK (kind IN ('all', 'stack', 'memory', 'delivery', 'orders')),
  count integer NOT NULL CHECK (count > 0),
  PRIMARY KEY (event_date, event, kind)
);
