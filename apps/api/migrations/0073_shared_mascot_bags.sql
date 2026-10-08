-- 새 4등급 가게 풀은 풀 참가자 모두가 같은 100개 재고를 소비한다.
SET LOCAL lock_timeout = '5s';

CREATE TABLE coin_shared_bags (
  pool_id uuid PRIMARY KEY REFERENCES coin_pools(id),
  cycle integer NOT NULL DEFAULT 1 CHECK (cycle > 0),
  bronze_remaining integer NOT NULL DEFAULT 50 CHECK (bronze_remaining BETWEEN 0 AND 50),
  silver_remaining integer NOT NULL DEFAULT 35 CHECK (silver_remaining BETWEEN 0 AND 35),
  gold_remaining integer NOT NULL DEFAULT 14 CHECK (gold_remaining BETWEEN 0 AND 14),
  prism_remaining integer NOT NULL DEFAULT 1 CHECK (prism_remaining BETWEEN 0 AND 1)
);

ALTER TABLE coin_reroll_tickets DROP CONSTRAINT coin_reroll_tickets_grade_check;
ALTER TABLE coin_reroll_tickets ADD CONSTRAINT coin_reroll_tickets_grade_check
  CHECK (grade IN ('NORMAL', 'BRONZE', 'SILVER', 'GOLD'));
ALTER TABLE coin_reroll_tickets ADD COLUMN source text NOT NULL DEFAULT 'ADMIN_GRANT';
ALTER TABLE coin_reroll_tickets ADD CONSTRAINT coin_reroll_tickets_source_enum_check
  CHECK (source IN ('ADMIN_GRANT', 'GRADE_DRAW'));
ALTER TABLE coin_reroll_tickets ALTER COLUMN granted_by_account_id DROP NOT NULL;
ALTER TABLE coin_reroll_tickets ADD CONSTRAINT coin_reroll_tickets_source_check
  CHECK ((source = 'ADMIN_GRANT' AND granted_by_account_id IS NOT NULL)
    OR (source = 'GRADE_DRAW' AND granted_by_account_id IS NULL));
