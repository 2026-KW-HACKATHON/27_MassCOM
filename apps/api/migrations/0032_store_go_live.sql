-- Issue #246: 관리자 웹에서 실제 점포를 공개하고 점주·보상 혜택·캠페인을 SQL 없이 운영한다.
-- 배포된 API(02cb7e7)가 이 스키마에서 그대로 동작하도록 열 추가와 CHECK 확장만 한다(migration이 API 교체보다 먼저 돈다).
-- 참조 번호는 운영자가 보관하는 동의서·확인 기록의 번호일 뿐이다. 영문·숫자만 남겼을 때 8자리 이상 이어진 숫자가 있으면
-- 전화번호·사업자등록번호일 수 있어 막는다(앱의 looksLikePersonalData 검사가 먼저 거절하고, 이 CHECK는 마지막 방어선이다).

ALTER TABLE merchants
  ADD COLUMN consent_document_ref text CHECK (
    consent_document_ref IS NULL OR (
      consent_document_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$'
      AND regexp_replace(consent_document_ref, '[^A-Za-z0-9]', '', 'g') !~ '[0-9]{8}'
    )
  ),
  ADD COLUMN published_at timestamptz;

ALTER TABLE badge_reward_offers
  ADD COLUMN consent_document_ref text CHECK (
    consent_document_ref IS NULL OR (
      consent_document_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$'
      AND regexp_replace(consent_document_ref, '[^A-Za-z0-9]', '', 'g') !~ '[0-9]{8}'
    )
  ),
  ADD COLUMN consent_checklist_version text CHECK (
    consent_checklist_version IS NULL OR char_length(consent_checklist_version) BETWEEN 1 AND 40
  );

-- 점주 올리기·내리기 감사의 대상 계정. 계정 삭제가 actor_account_id처럼 이 열도 비식별 별칭으로 바꾼다.
ALTER TABLE platform_admin_audit
  ADD COLUMN target_account_id text CHECK (target_account_id IS NULL OR length(btrim(target_account_id)) > 0);

CREATE INDEX platform_admin_audit_target
  ON platform_admin_audit (target_account_id)
  WHERE target_account_id IS NOT NULL;

-- 0030·0031의 8개 action 합집합에 이 이슈의 7개를 더한다. 이 CHECK를 다시 쓰는 다음 migration은 이 15개 전체를 이어받아야 한다.
ALTER TABLE platform_admin_audit
  DROP CONSTRAINT platform_admin_audit_action_check;

ALTER TABLE platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
  CHECK (action IN (
    'MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN', 'CAMPAIGN_DRAFT_CREATED', 'COUPON_VOIDED',
    'ACCOUNT_DELETION_PROCESSED', 'ACCOUNT_DELETION_REJECTED', 'ACCOUNT_DELETION_RECONCILED',
    'MERCHANT_PUBLISHED', 'MERCHANT_OWNER_GRANTED', 'MERCHANT_OWNER_REVOKED',
    'REWARD_OFFER_CREATED', 'REWARD_OFFER_PAUSED', 'CAMPAIGN_PUBLISHED', 'CAMPAIGN_PAUSED'
  ));

-- 대상 계정은 점주 변경 감사에만 있다. 옛 API의 action은 모두 대상이 없으므로 이 CHECK를 통과한다.
ALTER TABLE platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_target_check
  CHECK ((action IN ('MERCHANT_OWNER_GRANTED', 'MERCHANT_OWNER_REVOKED')) = (target_account_id IS NOT NULL));
