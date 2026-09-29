-- Issue #194: 계정 삭제 접수를 접수번호·취소 기간·처리 기한·처리 결과가 있는 요청으로 넓힌다.
-- 배포된 API(f1bba2d)의 `INSERT (account_id) ... ON CONFLICT (account_id) DO NOTHING`과
-- forget의 `DELETE ... WHERE account_id = $1`이 그대로 동작하도록 열 추가와 제약 완화만 한다.

ALTER TABLE account_deletion_intake_requests
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN receipt_hash bytea,
  ADD COLUMN status text NOT NULL DEFAULT 'REQUESTED',
  ADD COLUMN source text NOT NULL DEFAULT 'WEB',
  ADD COLUMN cancel_until timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  ADD COLUMN due_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN processed_at timestamptz,
  ADD COLUMN processed_by text,
  ADD COLUMN reject_reason text,
  ADD COLUMN deletion_request_id uuid REFERENCES account_deletion_requests(id);

-- 기존 접수는 REQUESTED로 남기고 접수번호가 없어 그 계정이 다시 접수하면 새로 발급한다.
-- 접수 24시간 뒤는 대개 이미 지났고 접수번호도 없어 곧바로 처리될 수 있으므로, 옛 접수도 이 마이그레이션 시각부터 24시간의
-- 취소 기간을 받는다. 처리 기한은 접수 7일 뒤를 지키되 취소 마감보다 앞서지 않게 한다.
UPDATE account_deletion_intake_requests
SET cancel_until = greatest(requested_at + interval '24 hours', now() + interval '24 hours'),
    due_at = greatest(requested_at + interval '7 days', now() + interval '24 hours');

-- 처리·취소·거절 뒤에는 원 계정 ID를 NULL로 만들어야 하므로 account_id는 더 이상 기본 키일 수 없다.
-- 같은 열의 일반 고유 색인이 구 API의 ON CONFLICT (account_id) 추론을 계속 받아 준다(NULL은 서로 다른 값이라 여러 개 허용).
ALTER TABLE account_deletion_intake_requests DROP CONSTRAINT account_deletion_intake_requests_pkey;
ALTER TABLE account_deletion_intake_requests ADD PRIMARY KEY (id);
ALTER TABLE account_deletion_intake_requests ALTER COLUMN account_id DROP NOT NULL;

CREATE UNIQUE INDEX account_deletion_intake_account_key
  ON account_deletion_intake_requests (account_id);
CREATE UNIQUE INDEX account_deletion_intake_receipt_key
  ON account_deletion_intake_requests (receipt_hash) WHERE receipt_hash IS NOT NULL;
CREATE INDEX account_deletion_intake_status_due
  ON account_deletion_intake_requests (status, due_at);

ALTER TABLE account_deletion_intake_requests
  ADD CONSTRAINT account_deletion_intake_status_check
    CHECK (status IN ('REQUESTED', 'CANCELLED', 'PROCESSED', 'REJECTED')),
  ADD CONSTRAINT account_deletion_intake_source_check
    CHECK (source IN ('WEB', 'SHOWCASE_APP')),
  ADD CONSTRAINT account_deletion_intake_receipt_hash_check
    CHECK (receipt_hash IS NULL OR octet_length(receipt_hash) = 32),
  -- 계정 ID는 활성 요청에만 있다: 계정당 REQUESTED 행이 최대 하나이고, 끝난 요청에는 원 ID가 남지 않는다.
  ADD CONSTRAINT account_deletion_intake_account_link_check
    CHECK ((status = 'REQUESTED') = (account_id IS NOT NULL)),
  ADD CONSTRAINT account_deletion_intake_due_check
    CHECK (cancel_until >= requested_at AND due_at >= cancel_until),
  ADD CONSTRAINT account_deletion_intake_result_check CHECK (
    (status <> 'PROCESSED' OR (deletion_request_id IS NOT NULL AND processed_at IS NOT NULL))
    AND (status <> 'REJECTED' OR (reject_reason IS NOT NULL AND processed_at IS NOT NULL))
    AND (status <> 'CANCELLED' OR cancelled_at IS NOT NULL)
  ),
  ADD CONSTRAINT account_deletion_intake_reject_reason_check
    CHECK (reject_reason IS NULL OR char_length(reject_reason) BETWEEN 1 AND 200),
  ADD CONSTRAINT account_deletion_intake_processed_by_check
    CHECK (processed_by IS NULL OR char_length(processed_by) BETWEEN 1 AND 80);

-- 계정 삭제 처리 감사 기록은 점포와 무관하다. 점포 행동은 여전히 merchant_id가 필수다.
ALTER TABLE platform_admin_audit ALTER COLUMN merchant_id DROP NOT NULL;

-- 같은 CHECK를 0030(#243, COUPON_VOIDED)도 다시 만든다. 나중에 적용되는 쪽이 이기므로 두 파일이 서로의 값을 모두 가진 합집합을
-- 쓴다. 0030이 없는 곳에서는 COUPON_VOIDED가 쓰이지 않을 뿐 해롭지 않다. 새 action을 더하는 쪽은 이 목록 전체를 이어받아야 한다.
ALTER TABLE platform_admin_audit
  DROP CONSTRAINT platform_admin_audit_action_check;

ALTER TABLE platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
  CHECK (action IN (
    'MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN', 'CAMPAIGN_DRAFT_CREATED', 'COUPON_VOIDED',
    'ACCOUNT_DELETION_PROCESSED', 'ACCOUNT_DELETION_REJECTED', 'ACCOUNT_DELETION_RECONCILED'
  ));

ALTER TABLE platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_subject_check
  CHECK ((action LIKE 'ACCOUNT_DELETION_%') = (merchant_id IS NULL));
