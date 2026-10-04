-- Issue #365: 관리자 캠페인 기간 연장의 감사 action을 허용한다.
-- 0032의 15개 action에 CAMPAIGN_EXTENDED만 더한다. 다음 확장도 이 16개 전체를 이어받아야 한다.
-- 이전 API는 새 action을 쓰지 않으므로 먼저 적용하거나 이전 이미지로 롤백해도 기존 쓰기를 그대로 허용한다.
-- 롤백 때 이 CHECK를 좁히지 않는다. 새 API가 이미 남긴 CAMPAIGN_EXTENDED 행도 계속 유효하다.

-- 실행기가 파일마다 BEGIN … COMMIT으로 감싼다. 운영 표의 잠금 대기는 5초에서 포기한다.
SET LOCAL lock_timeout = '5s';

ALTER TABLE platform_admin_audit
  DROP CONSTRAINT platform_admin_audit_action_check;

-- 기존 행은 더 좁은 0032 CHECK를 이미 만족한다. NOT VALID로 재검사를 생략해 잠금을 짧게 유지하고 새 쓰기에는 즉시 적용한다.
ALTER TABLE platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
  CHECK (action IN (
    'MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN', 'CAMPAIGN_DRAFT_CREATED', 'COUPON_VOIDED',
    'ACCOUNT_DELETION_PROCESSED', 'ACCOUNT_DELETION_REJECTED', 'ACCOUNT_DELETION_RECONCILED',
    'MERCHANT_PUBLISHED', 'MERCHANT_OWNER_GRANTED', 'MERCHANT_OWNER_REVOKED',
    'REWARD_OFFER_CREATED', 'REWARD_OFFER_PAUSED', 'CAMPAIGN_PUBLISHED', 'CAMPAIGN_PAUSED',
    'CAMPAIGN_EXTENDED'
  )) NOT VALID;
