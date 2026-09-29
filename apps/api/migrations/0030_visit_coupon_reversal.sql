-- 방문 취소·쿠폰 사용 되돌리기·쿠폰 무효화(Issue #243).
-- 이미 배포된 API(f1bba2d)와 호환된다: 열은 추가만 하고, 배포된 API가 쓰는 제약 이름
-- reward_entitlements_unique_goal은 같은 이름의 부분 제외 제약으로 바꿔 ON CONFLICT ON CONSTRAINT가 그대로 동작한다.
-- 그래서 배포 도중이나 롤백 뒤에도 옛 API의 방문 수령이 깨지지 않는다(배포 스크립트는 migration을 먼저 돌리고 되돌리지 않는다).
-- 설계: docs/superpowers/specs/2026-09-30-visit-coupon-reversal-design.md

-- 방문 취소: 사유 코드는 기존 cancellation_reason에 넣고 처리자·시각·메모를 더한다.
-- 기존 시험 데이터가 이 열 없이 CANCELED 행을 넣으므로 취소 행이 열을 채우도록 강제하지는 않는다.
ALTER TABLE visit_events
  ADD COLUMN canceled_at timestamptz,
  ADD COLUMN canceled_by_account_id text,
  ADD COLUMN cancellation_note text CHECK (cancellation_note IS NULL OR char_length(cancellation_note) <= 100),
  -- 세어지지 않는 이유가 점포 직원 계정(본인 적립 또는 직원 계정으로 받은 방문)일 때만 채운다. 같은 날 두 번째 방문은 NULL이다.
  ADD COLUMN progress_excluded_reason text CHECK (progress_excluded_reason IS NULL OR progress_excluded_reason = 'STAFF_SELF'),
  -- 다른 방문이 취소되어 이 방문이 대신 세어진 경우 그 취소 방문(감사용).
  ADD COLUMN promoted_by_visit_event_id uuid REFERENCES visit_events(id);

ALTER TABLE visit_events
  ADD CONSTRAINT visit_events_cancel_columns_check CHECK (
    status = 'CANCELED'
    OR (canceled_at IS NULL AND canceled_by_account_id IS NULL AND cancellation_note IS NULL)
  );

ALTER TABLE visit_events
  ADD CONSTRAINT visit_events_excluded_not_counted_check CHECK (progress_excluded_reason IS NULL OR NOT progress_counted);

CREATE INDEX visit_events_merchant_day_idx
  ON visit_events (merchant_id, business_date, occurred_at DESC);

-- 계정 삭제 시 처리자 열을 가명 처리하는 UPDATE가 전체 스캔하지 않도록 한다.
CREATE INDEX visit_events_canceled_by_idx
  ON visit_events (canceled_by_account_id)
  WHERE canceled_by_account_id IS NOT NULL;

-- 취소된 권리는 감사 기록으로 남기고 같은 목표를 다시 채우면 새 권리를 만든다.
-- 그래서 (고객, 캠페인, 목표) 유일성은 취소되지 않은 권리에만 건다. mint_jobs.entitlement_id UNIQUE는 그대로다.
-- 제약 이름을 그대로 두려고 부분 유일 색인 대신 같은 이름의 부분 제외 제약(EXCLUDE ... WHERE)을 쓴다:
-- 옛 API의 ON CONFLICT ON CONSTRAINT reward_entitlements_unique_goal DO NOTHING이 계속 동작한다.
-- 제외 제약은 열 목록 추론(ON CONFLICT (열...))의 대상이 아니고 DO UPDATE도 못 받으므로 새 코드도 제약 이름으로 DO NOTHING만 쓴다.
ALTER TABLE reward_entitlements
  ADD COLUMN canceled_at timestamptz,
  ADD COLUMN revoked_by_visit_event_id uuid REFERENCES visit_events(id);

ALTER TABLE reward_entitlements DROP CONSTRAINT reward_entitlements_unique_goal;
ALTER TABLE reward_entitlements ADD CONSTRAINT reward_entitlements_unique_goal
  EXCLUDE USING btree (
    customer_account_id WITH =,
    campaign_id WITH =,
    target_visit_count WITH =
  ) WHERE (status <> 'CANCELED');

-- 취소된 발행 작업이 어느 방문 취소로 닫혔는지(감사용). 권리의 revoked_by_visit_event_id와 함께 본다.
ALTER TABLE mint_jobs
  ADD COLUMN canceled_by_visit_event_id uuid REFERENCES visit_events(id);

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
    AND voided_at IS NULL AND void_reason IS NULL AND void_note IS NULL
    AND voided_by_account_id IS NULL AND void_visit_event_id IS NULL)
  OR (status = 'REDEEMED'
    AND redeemed_at IS NOT NULL AND length(btrim(redeemed_by_account_id)) > 0
    AND voided_at IS NULL AND void_reason IS NULL AND void_note IS NULL
    AND voided_by_account_id IS NULL AND void_visit_event_id IS NULL)
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

-- 이 CHECK는 다른 브랜치(Issue #194의 0031_account_deletion_processing.sql)도 통째로 다시 쓴다. 나중에 도는 쪽이 이기므로
-- 두 마이그레이션이 같은 합집합 목록을 쓴다: 이 브랜치의 COUPON_VOIDED와 그쪽의 ACCOUNT_DELETION_* 세 가지를 모두 넣는다.
-- 그쪽 action이 아직 없는 곳에서는 쓰이지 않을 뿐 해롭지 않다. 새 action을 더하는 쪽은 이 목록 전체를 이어받아야 한다.
ALTER TABLE platform_admin_audit
  DROP CONSTRAINT platform_admin_audit_action_check;

ALTER TABLE platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
  CHECK (action IN (
    'MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN', 'CAMPAIGN_DRAFT_CREATED', 'COUPON_VOIDED',
    'ACCOUNT_DELETION_PROCESSED', 'ACCOUNT_DELETION_REJECTED', 'ACCOUNT_DELETION_RECONCILED'
  ));
