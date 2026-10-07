ALTER TABLE mileage_credits DROP CONSTRAINT mileage_credits_reason_check;
ALTER TABLE mileage_credits ADD CONSTRAINT mileage_credits_reason_check
  CHECK (reason IN ('FRIENDSHIP', 'DRAW_BONUS', 'ROOM_VISIT'));

CREATE TABLE public_rooms (
  account_id text PRIMARY KEY CHECK (length(btrim(account_id)) > 0),
  id uuid NOT NULL UNIQUE,
  visible boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX public_rooms_visible_idx ON public_rooms (id) WHERE visible;

CREATE TABLE room_visits (
  id uuid PRIMARY KEY,
  visitor_account_id text NOT NULL CHECK (length(btrim(visitor_account_id)) > 0),
  room_id uuid NOT NULL REFERENCES public_rooms(id),
  business_date date NOT NULL,
  visited_at timestamptz NOT NULL,
  credited_mileage integer NOT NULL DEFAULT 0 CHECK (credited_mileage IN (0, 2)),
  CONSTRAINT room_visits_once_per_day UNIQUE (visitor_account_id, room_id, business_date)
);
CREATE INDEX room_visits_visitor_date_idx ON room_visits (visitor_account_id, business_date);
CREATE INDEX room_visits_room_idx ON room_visits (room_id);

CREATE TABLE room_stamps (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public_rooms(id),
  author_account_id text NOT NULL CHECK (length(btrim(author_account_id)) > 0),
  kind text NOT NULL CHECK (kind IN ('COZY', 'COOL', 'RETURN')),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL,
  hidden_at timestamptz,
  CONSTRAINT room_stamps_once_per_day UNIQUE (room_id, author_account_id, business_date)
);
CREATE INDEX room_stamps_room_recent_idx ON room_stamps (room_id, created_at DESC) WHERE hidden_at IS NULL;
CREATE INDEX room_stamps_author_idx ON room_stamps (author_account_id);

CREATE TABLE room_stamp_reports (
  reporter_account_id text NOT NULL CHECK (length(btrim(reporter_account_id)) > 0),
  stamp_id uuid NOT NULL REFERENCES room_stamps(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  moderated_by_account_id text,
  CHECK ((resolved_at IS NULL) = (moderated_by_account_id IS NULL)),
  PRIMARY KEY (reporter_account_id, stamp_id)
);

CREATE TABLE room_blocks (
  blocker_account_id text NOT NULL CHECK (length(btrim(blocker_account_id)) > 0),
  blocked_account_id text NOT NULL CHECK (length(btrim(blocked_account_id)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_account_id, blocked_account_id),
  CHECK (blocker_account_id <> blocked_account_id)
);
CREATE INDEX room_blocks_blocked_idx ON room_blocks (blocked_account_id);
