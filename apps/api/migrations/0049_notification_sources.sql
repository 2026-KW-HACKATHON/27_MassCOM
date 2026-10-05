-- Bind scheduler notices to the live record and the expiry described in their message.
-- Source columns remain optional for generic internal notices and older callers.
ALTER TABLE notification_items
  ADD COLUMN source_kind text CHECK (source_kind IN ('REWARD_AVAILABLE','COUPON_EXPIRING','CAMPAIGN_EXPIRING')),
  ADD COLUMN source_id text,
  ADD COLUMN source_expires_at timestamptz,
  ADD CONSTRAINT notification_source_shape CHECK (
    (source_kind IS NULL AND source_id IS NULL AND source_expires_at IS NULL)
    OR (source_kind IS NOT NULL AND source_kind=category AND source_id IS NOT NULL AND length(btrim(source_id))>0
      AND (source_kind='REWARD_AVAILABLE' OR source_expires_at IS NOT NULL))
  );

-- Recover pre-migration scheduler sources from their server-generated dedupe keys.
UPDATE notification_items item SET source_kind=item.category, source_id=source.id::text
FROM reward_entitlements source
WHERE item.category='REWARD_AVAILABLE' AND item.dedupe_key='reward:' || source.id::text;
UPDATE notification_items item SET source_kind=item.category, source_id=source.id::text,
  source_expires_at=substring(item.dedupe_key FROM length('coupon:' || source.id::text || ':')+1)::timestamptz
FROM badge_coupons source
WHERE item.category='COUPON_EXPIRING' AND left(item.dedupe_key,length('coupon:' || source.id::text || ':'))='coupon:' || source.id::text || ':'
  AND substring(item.dedupe_key FROM length('coupon:' || source.id::text || ':')+1)
    ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$';
UPDATE notification_items item SET source_kind=item.category, source_id=source.id,
  source_expires_at=substring(item.dedupe_key FROM length('campaign:' || source.id || ':')+1)::timestamptz
FROM campaigns source
WHERE item.category='CAMPAIGN_EXPIRING' AND left(item.dedupe_key,length('campaign:' || source.id || ':'))='campaign:' || source.id || ':'
  AND substring(item.dedupe_key FROM length('campaign:' || source.id || ':')+1)
    ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$';
