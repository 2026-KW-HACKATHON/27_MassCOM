SET LOCAL lock_timeout = '5s';

CREATE TABLE discovery_event_dedupe (
  event_id uuid PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX discovery_event_dedupe_expiry ON discovery_event_dedupe (created_at);

CREATE TABLE discovery_daily_events (
  merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  event text NOT NULL CHECK (event IN ('MAP_SELECT', 'DETAIL_VIEW', 'DIRECTIONS_OPEN', 'GOAL_SAVE')),
  source text NOT NULL CHECK (source IN ('list', 'map', 'recommendation', 'collection', 'friend', 'link', 'other')),
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (merchant_id, business_date, event, source)
);
CREATE INDEX discovery_daily_events_date ON discovery_daily_events (business_date);
