-- 등급 전체 뽑기는 기존 가게 이벤트권·방문 권리와 독립적인 한 번 지급 원장이다.
SET LOCAL lock_timeout = '5s';

CREATE TABLE grade_draws (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  request_id text NOT NULL CHECK (char_length(btrim(request_id)) BETWEEN 1 AND 100),
  grade text NOT NULL CHECK (grade IN ('BRONZE', 'SILVER', 'GOLD')),
  price integer NOT NULL CHECK (price IN (100, 200, 400)),
  pool_version text NOT NULL CHECK (pool_version ~ '^[0-9a-f]{64}$'),
  reward_kind text NOT NULL CHECK (reward_kind IN ('COIN', 'THEME', 'CHARACTER')),
  item_id text,
  publication_id uuid,
  grade_id text,
  duplicate boolean NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, request_id),
  CHECK ((reward_kind = 'COIN' AND item_id IS NULL AND publication_id IS NOT NULL AND grade_id IS NOT NULL)
    OR (reward_kind IN ('THEME', 'CHARACTER') AND item_id IS NOT NULL AND publication_id IS NULL AND grade_id IS NULL)),
  FOREIGN KEY (publication_id, grade_id) REFERENCES collectible_publication_grades(publication_id, grade_id)
);
CREATE INDEX grade_draws_account_recent ON grade_draws (account_id, created_at DESC);
CREATE INDEX grade_draws_coin_lookup ON grade_draws (publication_id, grade_id)
  WHERE reward_kind = 'COIN';

-- 신규 뽑기 캐릭터도 기존 대표 캐릭터의 소유 검증/외래 키를 그대로 이용한다.
ALTER TABLE account_characters DROP CONSTRAINT IF EXISTS account_characters_source_check;
ALTER TABLE account_characters ADD CONSTRAINT account_characters_source_check
  CHECK (source IN ('REROLL', 'GRADE_DRAW'));
