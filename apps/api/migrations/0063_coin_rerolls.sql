-- 코인 리롤권은 기존 방문 보상·가게권·등급 뽑기와 독립적이다. 운영 지급 정책은 별도 확정 전까지 없다.
SET LOCAL lock_timeout = '5s';

CREATE TABLE coin_reroll_tickets (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  grade text NOT NULL CHECK (grade IN ('NORMAL', 'SILVER')),
  request_id text NOT NULL CHECK (char_length(btrim(request_id)) BETWEEN 1 AND 100),
  granted_by_account_id text NOT NULL,
  acquired_at timestamptz NOT NULL,
  UNIQUE (account_id, request_id)
);
CREATE INDEX coin_reroll_tickets_account ON coin_reroll_tickets (account_id, acquired_at DESC);

CREATE TABLE coin_rerolls (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL UNIQUE REFERENCES coin_reroll_tickets(id),
  pool_id uuid NOT NULL REFERENCES coin_pools(id),
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  request_id text NOT NULL CHECK (char_length(btrim(request_id)) BETWEEN 1 AND 100),
  source_kind text NOT NULL CHECK (source_kind IN ('VISIT','STORE_DRAW','GRADE_DRAW','REROLL')),
  source_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  grade_id text NOT NULL,
  spent_source jsonb NOT NULL CHECK (jsonb_typeof(spent_source) = 'object'),
  result_coin jsonb NOT NULL CHECK (jsonb_typeof(result_coin) = 'object'),
  drawn_at timestamptz NOT NULL,
  UNIQUE (account_id, request_id),
  FOREIGN KEY (publication_id, grade_id) REFERENCES collectible_publication_grades(publication_id, grade_id)
);
CREATE INDEX coin_rerolls_account ON coin_rerolls (account_id, drawn_at DESC);

-- 개별 획득 행만 회수한다. 원래 발행·보상·NFT 기록은 삭제하지 않는다.
CREATE TABLE coin_reroll_consumptions (
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  source_kind text NOT NULL CHECK (source_kind IN ('VISIT','STORE_DRAW','GRADE_DRAW','REROLL')),
  source_id uuid NOT NULL,
  reroll_id uuid NOT NULL UNIQUE REFERENCES coin_rerolls(id),
  consumed_at timestamptz NOT NULL,
  PRIMARY KEY (source_kind, source_id)
);
