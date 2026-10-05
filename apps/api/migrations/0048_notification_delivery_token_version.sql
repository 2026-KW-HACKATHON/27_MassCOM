-- Fence Expo receipt effects to the exact push token binding authorized for dispatch.

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS push_token_id uuid,
  ADD COLUMN IF NOT EXISTS binding_revision integer CHECK (binding_revision IS NULL OR binding_revision >= 0);

CREATE INDEX IF NOT EXISTS notification_deliveries_token_version_idx
  ON notification_deliveries (push_token_id, binding_revision)
  WHERE push_token_id IS NOT NULL;
