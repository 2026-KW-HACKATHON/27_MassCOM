-- 개봉 표시만 보관한다. 기존 보상권과 NFT 지급·발행 상태는 변경하지 않는다.
CREATE TABLE store_ticket_openings (
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  entitlement_id uuid NOT NULL REFERENCES reward_entitlements(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, entitlement_id)
);
