-- Monotonic device binding fence for push token registration and logout cleanup.

ALTER TABLE push_tokens
  ADD COLUMN IF NOT EXISTS binding_revision integer NOT NULL DEFAULT 0 CHECK (binding_revision >= 0);

WITH ranked_active_devices AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY app_variant, device_id
           ORDER BY binding_revision DESC, updated_at DESC, id DESC
         ) AS keep_rank
  FROM push_tokens
  WHERE revoked_at IS NULL AND device_id IS NOT NULL
)
UPDATE push_tokens token
SET revoked_at = coalesce(token.revoked_at, now()), updated_at = now()
FROM ranked_active_devices ranked
WHERE token.id = ranked.id AND ranked.keep_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_active_device_binding_unique
  ON push_tokens (app_variant, device_id)
  WHERE revoked_at IS NULL AND device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS push_tokens_device_binding_idx
  ON push_tokens (app_variant, device_id, binding_revision DESC, updated_at DESC)
  WHERE revoked_at IS NULL AND device_id IS NOT NULL;
