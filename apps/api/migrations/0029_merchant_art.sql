-- 사장님 AI 가게 그림(Issue #236, D-048): 시안 라운드·이미지·가게 대표 그림·호출별 비용 기록. 추가형이며 기존 표를 바꾸지 않는다.
-- 요청자 계정 ID는 다른 표와 같은 text이고 참조 제약은 두지 않는다. 계정 삭제는 account-deletion.ts가 같은 거래에서 NULL로 바꾼다.
CREATE TABLE merchant_art_rounds (
  id uuid PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  requested_by_account_id text,
  status text NOT NULL CHECK (
    status IN ('DRAFTING', 'DRAFTS_READY', 'FINALIZING', 'FINAL_READY', 'APPLIED', 'FAILED')
  ),
  chosen_index integer CHECK (chosen_index BETWEEN 0 AND 3),
  failure_code text,
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 가게 하나에 진행 중(만드는 중) 라운드는 하나뿐이다.
CREATE UNIQUE INDEX merchant_art_rounds_one_in_progress
  ON merchant_art_rounds (merchant_id)
  WHERE status IN ('DRAFTING', 'FINALIZING');

-- 가게별 하루(한국 날짜) 시안 횟수 확인과 정리 대상 조회가 받친다.
CREATE INDEX merchant_art_rounds_merchant_date_idx
  ON merchant_art_rounds (merchant_id, business_date);

-- 이미지는 webp 바이트를 DB에 둔다. 라운드를 지우면 이미지도 함께 지워진다.
CREATE TABLE merchant_art_images (
  round_id uuid NOT NULL REFERENCES merchant_art_rounds(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('DRAFT', 'FINAL')),
  idx integer NOT NULL CHECK (idx BETWEEN 0 AND 3),
  style text NOT NULL,
  image bytea NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, kind, idx)
);

-- 가게가 지금 쓰는 대표 그림. 가게당 한 장이고 되돌리면 행을 지운다. 고객 앱은 sha256 주소로 가져간다.
CREATE TABLE merchant_art (
  merchant_id text PRIMARY KEY REFERENCES merchants(id),
  image bytea NOT NULL,
  sha256 text NOT NULL UNIQUE,
  round_id uuid,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- 이미지 생성 호출마다 비용(마이크로 USD)을 적는다. 호출 전에 예상 비용으로 먼저 적고 응답 usage로 실제 비용으로 고친다.
CREATE TABLE ai_art_spend (
  id bigserial PRIMARY KEY,
  merchant_id text,
  round_id uuid,
  kind text NOT NULL,
  micro_usd bigint NOT NULL CHECK (micro_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_art_spend_created_at_idx ON ai_art_spend (created_at);
