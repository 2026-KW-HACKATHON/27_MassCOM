SET LOCAL lock_timeout = '5s';

ALTER TABLE room_stamps ADD COLUMN message text;
ALTER TABLE room_stamps ADD CONSTRAINT room_stamps_message_shape CHECK (
  message IS NULL OR (char_length(message) BETWEEN 1 AND 120 AND message = btrim(message))
);
