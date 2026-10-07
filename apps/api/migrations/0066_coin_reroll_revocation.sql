-- 방문 취소는 그 방문 코인에서 이어진 리롤 결과까지 철회한다. 추첨 이력은 보존한다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE coin_rerolls
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_by_visit_event_id uuid REFERENCES visit_events(id),
  ADD CONSTRAINT coin_rerolls_revocation_pair CHECK ((revoked_at IS NULL) = (revoked_by_visit_event_id IS NULL));

CREATE INDEX coin_rerolls_source_chain ON coin_rerolls (source_kind, source_id)
  WHERE source_kind IN ('VISIT', 'REROLL');

ALTER TABLE coin_series_coupons
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_by_visit_event_id uuid REFERENCES visit_events(id),
  ADD CONSTRAINT coin_series_coupon_revocation_pair CHECK ((revoked_at IS NULL) = (revoked_by_visit_event_id IS NULL));
