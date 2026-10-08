SET LOCAL lock_timeout = '5s';

-- Legacy NEIGHBORS stays restricted to its existing audience until the owner changes it.
ALTER TABLE public_rooms DROP CONSTRAINT public_rooms_visibility_check;
ALTER TABLE public_rooms ADD CONSTRAINT public_rooms_visibility_check
  CHECK (visibility IN ('PRIVATE', 'FRIENDS', 'NEIGHBORS', 'PUBLIC'));
ALTER TABLE mileage_credits DROP CONSTRAINT mileage_credits_reason_check;
ALTER TABLE mileage_credits ADD CONSTRAINT mileage_credits_reason_check
  CHECK (reason IN ('FRIENDSHIP', 'DRAW_BONUS', 'ROOM_VISIT', 'ROOM_GUESTBOOK'));

CREATE TABLE room_guestbook_entries (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public_rooms(id),
  author_account_id text NOT NULL CHECK (length(btrim(author_account_id)) > 0),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 100),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 300 AND message=btrim(message)),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL,
  hidden_at timestamptz,
  owner_read_at timestamptz,
  credited_mileage integer NOT NULL CHECK (credited_mileage IN (0,5)),
  UNIQUE (author_account_id,request_id)
);
CREATE INDEX room_guestbook_entries_room_recent_idx ON room_guestbook_entries(room_id,created_at DESC,id DESC)
  WHERE hidden_at IS NULL;
CREATE INDEX room_guestbook_entries_author_day_idx ON room_guestbook_entries(author_account_id,business_date,room_id);
CREATE INDEX room_guestbook_entries_unread_idx ON room_guestbook_entries(room_id)
  WHERE hidden_at IS NULL AND owner_read_at IS NULL;
CREATE TABLE room_guestbook_reports (
  reporter_account_id text NOT NULL CHECK (length(btrim(reporter_account_id)) > 0),
  entry_id uuid NOT NULL REFERENCES room_guestbook_entries(id),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  moderated_by_account_id text,
  CHECK ((resolved_at IS NULL) = (moderated_by_account_id IS NULL)),
  PRIMARY KEY (reporter_account_id,entry_id)
);
