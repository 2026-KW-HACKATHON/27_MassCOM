-- 가게별 고정 확률 뽑기권과 수집 시리즈. 운영 데이터는 생성하지 않는다.
SET LOCAL lock_timeout = '5s';

CREATE TABLE coin_pools (
  id uuid PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  event_name text NOT NULL CHECK (char_length(btrim(event_name)) BETWEEN 1 AND 80),
  grade text NOT NULL CHECK (grade IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM')),
  price integer NOT NULL CHECK (price BETWEEN 1 AND 100000),
  purchase_starts_at timestamptz NOT NULL,
  purchase_ends_at timestamptz NOT NULL,
  use_expires_at timestamptz NOT NULL,
  per_account_limit integer NOT NULL CHECK (per_account_limit BETWEEN 1 AND 100),
  issuance_cap integer NOT NULL CHECK (issuance_cap BETWEEN 1 AND 100000),
  issued_count integer NOT NULL DEFAULT 0 CHECK (issued_count >= 0 AND issued_count <= issuance_cap),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (purchase_starts_at < purchase_ends_at AND purchase_ends_at < use_expires_at)
);
CREATE INDEX coin_pools_active_window ON coin_pools (purchase_starts_at, purchase_ends_at) WHERE status = 'ACTIVE';

CREATE TABLE coin_pool_entries (
  pool_id uuid NOT NULL REFERENCES coin_pools(id),
  publication_id uuid NOT NULL,
  grade_id text NOT NULL,
  weight integer NOT NULL CHECK (weight BETWEEN 1 AND 100000),
  PRIMARY KEY (pool_id, publication_id, grade_id),
  FOREIGN KEY (publication_id, grade_id) REFERENCES collectible_publication_grades(publication_id, grade_id)
);

CREATE TABLE coin_tickets (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  pool_id uuid NOT NULL REFERENCES coin_pools(id),
  request_id text NOT NULL CHECK (char_length(btrim(request_id)) BETWEEN 1 AND 100),
  source text NOT NULL CHECK (source IN ('PURCHASE', 'GRANT')),
  price integer NOT NULL CHECK (price >= 0),
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  UNIQUE (account_id, request_id),
  CHECK (expires_at > acquired_at AND (used_at IS NULL OR used_at >= acquired_at))
);
CREATE INDEX coin_tickets_account_pool ON coin_tickets (account_id, pool_id);
CREATE INDEX coin_tickets_account_live ON coin_tickets (account_id, expires_at) WHERE used_at IS NULL;

CREATE TABLE coin_draws (
  ticket_id uuid PRIMARY KEY REFERENCES coin_tickets(id),
  publication_id uuid NOT NULL,
  grade_id text NOT NULL,
  drawn_at timestamptz NOT NULL,
  FOREIGN KEY (publication_id, grade_id) REFERENCES collectible_publication_grades(publication_id, grade_id)
);

CREATE TABLE coin_series (
  id uuid PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED')),
  base_title text NOT NULL CHECK (char_length(btrim(base_title)) BETWEEN 1 AND 40),
  base_detail text NOT NULL CHECK (char_length(base_detail) <= 120),
  base_valid_days integer NOT NULL CHECK (base_valid_days BETWEEN 1 AND 365),
  base_cap integer NOT NULL CHECK (base_cap BETWEEN 1 AND 10000),
  base_issued integer NOT NULL DEFAULT 0 CHECK (base_issued >= 0 AND base_issued <= base_cap),
  prism_title text NOT NULL CHECK (char_length(btrim(prism_title)) BETWEEN 1 AND 40),
  prism_detail text NOT NULL CHECK (char_length(prism_detail) <= 120),
  prism_valid_days integer NOT NULL CHECK (prism_valid_days BETWEEN 1 AND 365),
  prism_cap integer NOT NULL CHECK (prism_cap BETWEEN 1 AND 10000),
  prism_issued integer NOT NULL DEFAULT 0 CHECK (prism_issued >= 0 AND prism_issued <= prism_cap),
  consent_document_ref text NOT NULL CHECK (
    consent_document_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$'
    AND regexp_replace(consent_document_ref, '[^A-Za-z0-9]', '', 'g') !~ '[0-9]{8}'
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coin_series_active ON coin_series (ends_at) WHERE status = 'ACTIVE';

CREATE TABLE coin_series_entries (
  series_id uuid NOT NULL REFERENCES coin_series(id),
  tier text NOT NULL CHECK (tier IN ('BASE', 'PRISM')),
  publication_id uuid NOT NULL,
  grade_id text NOT NULL,
  PRIMARY KEY (series_id, tier, publication_id, grade_id),
  FOREIGN KEY (publication_id, grade_id) REFERENCES collectible_publication_grades(publication_id, grade_id)
);

CREATE TABLE coin_series_coupons (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  series_id uuid NOT NULL REFERENCES coin_series(id),
  merchant_id text NOT NULL REFERENCES merchants(id),
  tier text NOT NULL CHECK (tier IN ('BASE', 'PRISM')),
  title text NOT NULL,
  detail text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  redeemed_by_account_id text,
  UNIQUE (account_id, series_id),
  CHECK (expires_at > issued_at),
  CHECK ((redeemed_at IS NULL) = (redeemed_by_account_id IS NULL))
);
CREATE INDEX coin_series_coupons_staff ON coin_series_coupons (account_id, merchant_id, expires_at) WHERE redeemed_at IS NULL;
CREATE INDEX coin_series_coupons_redeemer ON coin_series_coupons (redeemed_by_account_id) WHERE redeemed_by_account_id IS NOT NULL;

-- 판매 중단과 발행 수만 바꿀 수 있다. 티켓에 표시한 확률·가격·기한을 사후 변경하지 않는다.
CREATE FUNCTION coin_pool_terms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'status' - 'issued_count') = (to_jsonb(OLD) - 'status' - 'issued_count')
     AND NEW.issued_count BETWEEN OLD.issued_count AND OLD.issued_count + 1
     AND (NEW.status = OLD.status OR (OLD.status = 'ACTIVE' AND NEW.status = 'PAUSED')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'coin pool terms are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER coin_pool_terms_immutable BEFORE UPDATE OR DELETE ON coin_pools
  FOR EACH ROW EXECUTE FUNCTION coin_pool_terms_guard();
CREATE TRIGGER coin_pool_entries_immutable BEFORE UPDATE OR DELETE ON coin_pool_entries
  FOR EACH ROW EXECUTE FUNCTION collectible_publication_immutable();

CREATE FUNCTION coin_series_terms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'status' - 'base_issued' - 'prism_issued')
    = (to_jsonb(OLD) - 'status' - 'base_issued' - 'prism_issued')
    AND NEW.base_issued BETWEEN OLD.base_issued AND OLD.base_issued + 1
    AND NEW.prism_issued BETWEEN OLD.prism_issued AND OLD.prism_issued + 1
    AND (NEW.status = OLD.status OR (OLD.status = 'ACTIVE' AND NEW.status = 'PAUSED')) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'coin series terms are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER coin_series_terms_immutable BEFORE UPDATE OR DELETE ON coin_series
  FOR EACH ROW EXECUTE FUNCTION coin_series_terms_guard();
CREATE TRIGGER coin_series_entries_immutable BEFORE UPDATE OR DELETE ON coin_series_entries
  FOR EACH ROW EXECUTE FUNCTION collectible_publication_immutable();
