-- 마일리지 상점(Issue #298): 번 마일리지는 저장하지 않고 배지 집계와 같은 집계 SQL로 계산한다
-- (countedVisitFromSql/countedVisitFilterSql 재사용, apps/api/src/postgres/badge-rewards.ts).
-- 저장하는 값은 재뽑기 지출 원장·소유 캐릭터·대표 캐릭터뿐이다. 코드·코인 환전·송금은 없다(D-0xx).
-- 번호 순서: #300(PR)이 먼저 0037을 썼다면 그 PR이 main에 먼저 병합돼야 번호가 겹치지 않는다
-- (migrate.ts는 파일명 순으로 적용하므로 0037 없이 0038만 있어도 그 자체로는 동작한다).
CREATE TABLE mileage_spends (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  amount integer NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (reason IN ('REROLL')),
  grade text NOT NULL CHECK (grade IN ('BRONZE', 'SILVER', 'GOLD')),
  item_id text NOT NULL CHECK (length(btrim(item_id)) > 0),
  request_id text NOT NULL CHECK (length(btrim(request_id)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mileage_spends_account_request_unique UNIQUE (account_id, request_id)
);

-- 잔액 합산(계정별 sum)과 시간당 재뽑기 횟수 제한(계정 + 최근 시각) 조회가 쓴다.
CREATE INDEX mileage_spends_account_lookup ON mileage_spends (account_id, created_at);

CREATE TABLE account_characters (
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  item_id text NOT NULL CHECK (length(btrim(item_id)) > 0),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('REROLL')),
  PRIMARY KEY (account_id, item_id)
);

CREATE TABLE account_profile (
  account_id text PRIMARY KEY,
  avatar_item_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 대표 캐릭터는 그 계정이 가진 캐릭터만 가리킬 수 있고, 그 캐릭터 행이 지워지면(계정 삭제 정리)
  -- avatar_item_id만 NULL로 돌아간다(PostgreSQL 15+ 컬럼 지정 ON DELETE SET NULL).
  FOREIGN KEY (account_id, avatar_item_id)
    REFERENCES account_characters (account_id, item_id) ON DELETE SET NULL (avatar_item_id)
);

-- 계정 삭제는 세 테이블 모두 apps/api/src/postgres/account-deletion.ts의 pseudonymizeAccount에서 지운다
-- (가명 처리하지 않음: 보존 기간 없음, 재뽑기 지출·소유 캐릭터는 계정 수명 이상 남길 이유가 없다).
