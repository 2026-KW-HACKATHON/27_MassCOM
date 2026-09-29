-- 방문 취소·쿠폰 사용 되돌리기·쿠폰 무효화(Issue #243). 추가하거나 제약을 풀기만 하고 지우는 변경은 없다.
-- 설계: docs/superpowers/specs/2026-09-30-visit-coupon-reversal-design.md

-- 방문 취소: 사유 코드는 기존 cancellation_reason에 넣고 처리자·시각·메모를 더한다.
-- 기존 시험 데이터가 이 열 없이 CANCELED 행을 넣으므로 취소 행이 열을 채우도록 강제하지는 않는다.
ALTER TABLE visit_events
  ADD COLUMN canceled_at timestamptz,
  ADD COLUMN canceled_by_account_id text,
  ADD COLUMN cancellation_note text CHECK (cancellation_note IS NULL OR char_length(cancellation_note) <= 100);

ALTER TABLE visit_events
  ADD CONSTRAINT visit_events_cancel_columns_check CHECK (
    status = 'CANCELED'
    OR (canceled_at IS NULL AND canceled_by_account_id IS NULL AND cancellation_note IS NULL)
  );

CREATE INDEX visit_events_merchant_day_idx
  ON visit_events (merchant_id, business_date, occurred_at DESC);

-- 계정 삭제 시 처리자 열을 가명 처리하는 UPDATE가 전체 스캔하지 않도록 한다.
CREATE INDEX visit_events_canceled_by_idx
  ON visit_events (canceled_by_account_id)
  WHERE canceled_by_account_id IS NOT NULL;

-- 취소된 권리는 감사 기록으로 남기고 같은 목표를 다시 채우면 새 권리를 만든다.
-- 그래서 (고객, 캠페인, 목표) 유일성은 취소되지 않은 권리에만 건다. mint_jobs.entitlement_id UNIQUE는 그대로다.
ALTER TABLE reward_entitlements
  ADD COLUMN canceled_at timestamptz,
  ADD COLUMN revoked_by_visit_event_id uuid REFERENCES visit_events(id);

ALTER TABLE reward_entitlements DROP CONSTRAINT reward_entitlements_unique_goal;

CREATE UNIQUE INDEX reward_entitlements_active_goal_unique
  ON reward_entitlements (customer_account_id, campaign_id, target_visit_count)
  WHERE status <> 'CANCELED';

-- 쿠폰: VOIDED 상태와 무효 사유. 사용하지 않은 쿠폰만 무효가 된다.
ALTER TABLE badge_coupons
  ADD COLUMN void_reason text CHECK (
    void_reason IS NULL OR void_reason IN (
      'VISIT_CANCELED', 'ISSUED_IN_ERROR', 'ABUSE_SUSPECTED', 'MERCHANT_REQUEST', 'OTHER'
    )
  ),
  ADD COLUMN void_note text CHECK (void_note IS NULL OR char_length(void_note) <= 100),
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by_account_id text,
  ADD COLUMN void_visit_event_id uuid REFERENCES visit_events(id);

ALTER TABLE badge_coupons DROP CONSTRAINT badge_coupons_status_check;
ALTER TABLE badge_coupons ADD CONSTRAINT badge_coupons_status_check
  CHECK (status IN ('ISSUED', 'REDEEMED', 'VOIDED'));

ALTER TABLE badge_coupons DROP CONSTRAINT badge_coupons_check1;
ALTER TABLE badge_coupons ADD CONSTRAINT badge_coupons_state_columns_check CHECK (
  (status = 'ISSUED'
    AND redeemed_at IS NULL AND redeemed_by_account_id IS NULL
    AND voided_at IS NULL AND void_reason IS NULL)
  OR (status = 'REDEEMED'
    AND redeemed_at IS NOT NULL AND length(btrim(redeemed_by_account_id)) > 0
    AND voided_at IS NULL AND void_reason IS NULL)
  OR (status = 'VOIDED'
    AND redeemed_at IS NULL AND redeemed_by_account_id IS NULL
    AND voided_at IS NOT NULL AND void_reason IS NOT NULL)
);

CREATE INDEX badge_coupons_merchant_redeemed_idx
  ON badge_coupons (merchant_id, redeemed_at DESC)
  WHERE status = 'REDEEMED';

CREATE INDEX badge_coupons_voided_by_idx
  ON badge_coupons (voided_by_account_id)
  WHERE voided_by_account_id IS NOT NULL;

-- 사용 되돌리기·재계산 무효화·되살리기 감사. 관리자 무효화는 platform_admin_audit에 남긴다.
CREATE TABLE badge_coupon_audit (
  id uuid PRIMARY KEY,
  coupon_id uuid NOT NULL REFERENCES badge_coupons(id),
  merchant_id text NOT NULL REFERENCES merchants(id),
  action text NOT NULL CHECK (
    action IN ('REDEMPTION_UNDONE', 'VOIDED_ON_RECOUNT', 'REISSUED_AFTER_RECOUNT')
  ),
  actor_account_id text,
  previous_redeemed_at timestamptz,
  previous_redeemed_by_account_id text,
  visit_event_id uuid REFERENCES visit_events(id),
  created_at timestamptz NOT NULL
);

CREATE INDEX badge_coupon_audit_coupon_time_idx ON badge_coupon_audit (coupon_id, created_at);
CREATE INDEX badge_coupon_audit_actor_idx
  ON badge_coupon_audit (actor_account_id) WHERE actor_account_id IS NOT NULL;
CREATE INDEX badge_coupon_audit_redeemed_by_idx
  ON badge_coupon_audit (previous_redeemed_by_account_id) WHERE previous_redeemed_by_account_id IS NOT NULL;

ALTER TABLE platform_admin_audit
  DROP CONSTRAINT platform_admin_audit_action_check;

ALTER TABLE platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
  CHECK (action IN (
    'MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN', 'CAMPAIGN_DRAFT_CREATED', 'COUPON_VOIDED'
  ));
