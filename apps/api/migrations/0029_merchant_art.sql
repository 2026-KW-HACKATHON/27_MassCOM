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
  -- 최종 그림을 만드는 시도 표지: 시안을 고를 때 적는 ai_art_spend(FINAL) 행 id. 실패·중단된 최종을 같은 라운드에서 다시 고르면 새 값으로
  -- 바뀌므로, 늦게 끝난 옛 시도가 새 시도의 이미지·상태를 덮어쓰지 못하게 저장과 상태 갱신이 이 값과 맞을 때만 일어난다. 참조 제약은 두지 않는다.
  final_spend_id bigint,
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
-- sha256은 유일하지 않다: 서로 다른 가게가 우연히 같은 그림 바이트를 적용해도 적용이 실패하면 안 되기 때문이다(같은 sha256이면 바이트도
-- 같으므로 공개 조회는 가게 id 순으로 한 행을 고른다).
CREATE TABLE merchant_art (
  merchant_id text PRIMARY KEY REFERENCES merchants(id),
  image bytea NOT NULL,
  sha256 text NOT NULL,
  round_id uuid,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX merchant_art_sha256_idx ON merchant_art (sha256);

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
