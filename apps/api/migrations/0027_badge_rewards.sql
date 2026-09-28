-- 탐험 여권 보상 상자(Issue #216): 점주 동의가 기록된 혜택과 고객별 쿠폰.
-- 운영 DB는 점주 동의 뒤 수동 등록 전까지 badge_reward_offers가 비어 있고, 시연 DB만 seed로 채운다.
CREATE TABLE badge_reward_offers (
  id uuid PRIMARY KEY,
  milestone smallint NOT NULL CHECK (milestone BETWEEN 1 AND 3),
  merchant_id text NOT NULL REFERENCES merchants(id),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 40),
  detail text NOT NULL CHECK (char_length(detail) <= 120),
  valid_days integer NOT NULL CHECK (valid_days BETWEEN 1 AND 365),
  issuance_cap integer CHECK (issuance_cap IS NULL OR issuance_cap > 0),
  issued_count integer NOT NULL DEFAULT 0 CHECK (issued_count >= 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED')),
  consent_note text NOT NULL CHECK (length(btrim(consent_note)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT badge_reward_offers_id_milestone_unique UNIQUE (id, milestone)
);

CREATE UNIQUE INDEX badge_reward_offers_one_active_per_milestone
  ON badge_reward_offers (milestone)
  WHERE status = 'ACTIVE';

CREATE TABLE badge_coupons (
  id uuid PRIMARY KEY,
  customer_account_id text NOT NULL CHECK (length(btrim(customer_account_id)) > 0),
  milestone smallint NOT NULL,
  offer_id uuid NOT NULL,
  merchant_id text NOT NULL REFERENCES merchants(id),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 40),
  detail text NOT NULL CHECK (char_length(detail) <= 120),
  status text NOT NULL CHECK (status IN ('ISSUED', 'REDEEMED')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  redeemed_by_account_id text,
  CONSTRAINT badge_coupons_unique_account_milestone UNIQUE (customer_account_id, milestone),
  CONSTRAINT badge_coupons_offer_milestone_fk
    FOREIGN KEY (offer_id, milestone) REFERENCES badge_reward_offers (id, milestone),
  CHECK (expires_at > issued_at),
  CHECK (
    (status = 'ISSUED' AND redeemed_at IS NULL AND redeemed_by_account_id IS NULL)
    OR (status = 'REDEEMED' AND redeemed_at IS NOT NULL
        AND length(btrim(redeemed_by_account_id)) > 0)
  )
);

CREATE INDEX badge_coupons_merchant_lookup
  ON badge_coupons (customer_account_id, merchant_id)
  WHERE status = 'ISSUED';

-- 계정 삭제 시 사용 처리자 열을 가명 처리하는 UPDATE가 전체 스캔하지 않도록 한다.
CREATE INDEX badge_coupons_redeemed_by_idx
  ON badge_coupons (redeemed_by_account_id)
  WHERE redeemed_by_account_id IS NOT NULL;
