ALTER TABLE platform_admin_audit
  DROP CONSTRAINT platform_admin_audit_action_check;

ALTER TABLE platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
  CHECK (action IN ('MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN', 'CAMPAIGN_DRAFT_CREATED'));
