-- Issue #294: 점주 체험 권한 요청. 시연 DB(hosted·local)에서만 쓰이지만, migration은 운영 DB에도 똑같이 돌아
-- 빈 표만 만든다(시연·운영 스키마 분기 없음). 쓰기는 API가 resolveShowcaseDeployment로 시연 DB에서만 연다.
CREATE TABLE showcase_access_requests (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK (btrim(account_id) <> ''),
  -- Crockford base32(대문자, I·L·O·U 제외) 8자. 보여줄 때만 앱이 XXXX-XXXX로 나눈다.
  code text NOT NULL UNIQUE CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by_account_id text,
  decided_via text CHECK (decided_via IN ('APP', 'OPS')),
  decided_db_user text,
  CHECK ((status = 'PENDING') = (decided_at IS NULL AND decided_via IS NULL)),
  CHECK (decided_via IS DISTINCT FROM 'APP' OR decided_by_account_id IS NOT NULL)
);

-- 계정마다 대기 중 요청은 하나만. 거절·수락된 행은 그대로 두고 다시 문의하면 새 행을 만든다.
CREATE UNIQUE INDEX showcase_access_requests_pending_account
  ON showcase_access_requests (account_id) WHERE status = 'PENDING';

CREATE INDEX showcase_access_requests_pending_created
  ON showcase_access_requests (created_at) WHERE status = 'PENDING';
