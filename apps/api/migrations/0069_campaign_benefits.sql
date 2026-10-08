-- Issue #412 (D-094): 점주 동의로 정한 캠페인 혜택과 추가 원가 상한. 옛 API와 캠페인은 그대로 동작한다.
SET LOCAL lock_timeout = '5s';

CREATE TABLE campaign_benefits (
  id uuid PRIMARY KEY,
  campaign_id text NOT NULL,
  merchant_id text NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 40),
  detail text NOT NULL CHECK (char_length(detail) <= 120),
  valid_days integer NOT NULL CHECK (valid_days BETWEEN 1 AND 60),
  unit_extra_cost_won integer NOT NULL CHECK (unit_extra_cost_won BETWEEN 1 AND 1000000),
  max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 10000),
  issued_count integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED')),
  consent_document_ref text NOT NULL CHECK (
    consent_document_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$'
    AND regexp_replace(consent_document_ref, '[^A-Za-z0-9]', '', 'g') !~ '[0-9]{8}'
  ),
  consent_checklist_version text NOT NULL CHECK (consent_checklist_version = 'owner-offer-consent-v1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_benefits_campaign_merchant_fk FOREIGN KEY (campaign_id, merchant_id)
    REFERENCES campaigns(id, merchant_id),
  CONSTRAINT campaign_benefits_id_campaign_merchant_unique UNIQUE (id, campaign_id, merchant_id),
  CONSTRAINT campaign_benefits_issued_count_check CHECK (issued_count BETWEEN 0 AND max_uses)
);

CREATE UNIQUE INDEX campaign_benefits_one_active_per_campaign
  ON campaign_benefits(campaign_id) WHERE status = 'ACTIVE';

-- 비용·상한을 사후 변경하지 않는다. 발급/무효화는 카운터를 정확히 한 칸만 옮긴다.
CREATE FUNCTION campaign_benefits_terms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'campaign benefit terms are immutable' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'issued_count') <> (to_jsonb(OLD) - 'status' - 'issued_count')
     OR (NEW.status <> OLD.status AND NOT (OLD.status = 'ACTIVE' AND NEW.status = 'PAUSED'))
     OR abs(NEW.issued_count - OLD.issued_count) > 1 THEN
    RAISE EXCEPTION 'campaign benefit terms are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_benefits_terms_immutable BEFORE UPDATE OR DELETE ON campaign_benefits
  FOR EACH ROW EXECUTE FUNCTION campaign_benefits_terms_guard();

CREATE TABLE campaign_benefit_coupons (
  id uuid PRIMARY KEY,
  benefit_id uuid NOT NULL,
  campaign_id text NOT NULL,
  merchant_id text NOT NULL REFERENCES merchants(id),
  customer_account_id text NOT NULL CHECK (char_length(btrim(customer_account_id)) > 0),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 40),
  detail text NOT NULL CHECK (char_length(detail) <= 120),
  unit_extra_cost_won integer NOT NULL CHECK (unit_extra_cost_won BETWEEN 1 AND 1000000),
  source_visit_event_id uuid NOT NULL REFERENCES visit_events(id),
  status text NOT NULL CHECK (status IN ('ISSUED', 'REDEEMED', 'VOIDED')),
  issued_at timestamptz NOT NULL,
  usable_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  redeemed_by_account_id text,
  voided_at timestamptz,
  void_reason text CHECK (void_reason IS NULL OR void_reason IN
    ('VISIT_CANCELED', 'ISSUED_IN_ERROR', 'ABUSE_SUSPECTED', 'MERCHANT_REQUEST', 'OTHER')),
  voided_by_account_id text,
  CONSTRAINT campaign_benefit_coupons_benefit_fk FOREIGN KEY (benefit_id, campaign_id, merchant_id)
    REFERENCES campaign_benefits(id, campaign_id, merchant_id),
  CONSTRAINT campaign_benefit_coupons_time_check CHECK (expires_at > issued_at AND usable_from <= expires_at),
  CONSTRAINT campaign_benefit_coupons_state_columns_check CHECK (
    (status = 'ISSUED' AND redeemed_at IS NULL AND redeemed_by_account_id IS NULL
      AND voided_at IS NULL AND void_reason IS NULL AND voided_by_account_id IS NULL)
    OR (status = 'REDEEMED' AND redeemed_at IS NOT NULL AND redeemed_by_account_id IS NOT NULL
      AND char_length(btrim(redeemed_by_account_id)) > 0
      AND voided_at IS NULL AND void_reason IS NULL AND voided_by_account_id IS NULL)
    OR (status = 'VOIDED' AND redeemed_at IS NULL AND redeemed_by_account_id IS NULL
      AND voided_at IS NOT NULL AND void_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX campaign_benefit_coupons_one_per_customer_campaign
  ON campaign_benefit_coupons(customer_account_id, campaign_id)
  WHERE NOT (status = 'VOIDED' AND void_reason = 'VISIT_CANCELED');
CREATE INDEX campaign_benefit_coupons_customer_merchant_issued
  ON campaign_benefit_coupons(customer_account_id, merchant_id) WHERE status = 'ISSUED';
CREATE INDEX campaign_benefit_coupons_benefit_status
  ON campaign_benefit_coupons(benefit_id, status);
CREATE INDEX campaign_benefit_coupons_redeemed_by
  ON campaign_benefit_coupons(redeemed_by_account_id) WHERE redeemed_by_account_id IS NOT NULL;
CREATE INDEX campaign_benefit_coupons_voided_by
  ON campaign_benefit_coupons(voided_by_account_id) WHERE voided_by_account_id IS NOT NULL;

-- 0068의 전체 action 합집합을 이어받는다. courses 브랜치의 0072 재작성도 이 두 action을 포함해야 한다.
ALTER TABLE platform_admin_audit DROP CONSTRAINT platform_admin_audit_action_check;
ALTER TABLE platform_admin_audit ADD CONSTRAINT platform_admin_audit_action_check CHECK (action IN (
  'MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN', 'CAMPAIGN_DRAFT_CREATED', 'COUPON_VOIDED',
  'ACCOUNT_DELETION_PROCESSED', 'ACCOUNT_DELETION_REJECTED', 'ACCOUNT_DELETION_RECONCILED',
  'MERCHANT_PUBLISHED', 'MERCHANT_OWNER_GRANTED', 'MERCHANT_OWNER_REVOKED',
  'REWARD_OFFER_CREATED', 'REWARD_OFFER_PAUSED', 'CAMPAIGN_PUBLISHED', 'CAMPAIGN_PAUSED',
  'CAMPAIGN_EXTENDED', 'CAMPAIGN_PURPOSE_SET', 'CAMPAIGN_BENEFIT_CREATED', 'CAMPAIGN_BENEFIT_PAUSED'
)) NOT VALID;
