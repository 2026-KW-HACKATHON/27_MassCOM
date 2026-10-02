-- 방문한 손님이 그 가게에 남기는 특징 태그(최대 3, 공개 집계)와 사장님께 바라는 점(최대 2)·짧은 의견(100자 이하)(Issue #334, D-069).
-- 가게마다 계정당 한 줄이고 다시 고르면 덮어쓴다. 바라는 점·의견은 그 가게 점주·직원에게만 보이고 공개하지 않는다.
-- 코드 목록은 apps/api/src/visitor-feedback-rules.ts와 같아야 한다(서버 시험이 두 곳을 대조한다). 추가만 하는 migration이라 옛 API와 함께 돌아도 된다.
-- 계정 삭제는 apps/api/src/postgres/account-deletion.ts의 pseudonymizeAccount에서 이 계정의 행을 지운다(가명으로 남기지 않음, 보존 기간 없음).

-- 코드 배열 검사: 허용 목록의 부분집합이고 개수가 max_count 이하이며 중복이 없다. CHECK에는 부분 질의를 쓸 수 없어 함수로 묶었다.
CREATE FUNCTION merchant_visitor_feedback_codes_ok(codes text[], allowed text[], max_count integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT cardinality(codes) <= max_count
    AND codes <@ allowed
    AND cardinality(codes) = (SELECT count(DISTINCT code) FROM unnest(codes) AS code)
$$;

CREATE TABLE merchant_visitor_feedback (
  customer_account_id text NOT NULL CHECK (length(btrim(customer_account_id)) > 0),
  merchant_id text NOT NULL REFERENCES merchants(id),
  tags text[] NOT NULL DEFAULT '{}' CONSTRAINT merchant_visitor_feedback_tags_check CHECK (
    merchant_visitor_feedback_codes_ok(
      tags,
      ARRAY['SOLO', 'TAKEOUT', 'GENEROUS', 'QUIET', 'KIND', 'VALUE', 'STUDENT', 'DESSERT']::text[],
      3
    )
  ),
  suggestions text[] NOT NULL DEFAULT '{}' CONSTRAINT merchant_visitor_feedback_suggestions_check CHECK (
    merchant_visitor_feedback_codes_ok(
      suggestions,
      ARRAY['SOLO_MENU', 'SPICE_LABEL', 'MORE_PHOTOS', 'STUDENT_DISCOUNT', 'HOURS_INFO']::text[],
      2
    )
  ),
  note text CONSTRAINT merchant_visitor_feedback_note_check CHECK (
    note IS NULL OR (char_length(note) <= 100 AND length(btrim(note)) > 0)
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_account_id, merchant_id),
  -- 아무것도 고르지 않은 저장은 행을 지운다(서비스). 빈 행이 응답 수에 끼지 않게 DB도 막는다.
  CONSTRAINT merchant_visitor_feedback_not_empty_check CHECK (
    cardinality(tags) > 0 OR cardinality(suggestions) > 0 OR note IS NOT NULL
  )
);

-- 가게별 태그 집계(공개 목록)와 점주 요약이 가게 단위로 읽는다.
CREATE INDEX merchant_visitor_feedback_merchant_lookup ON merchant_visitor_feedback (merchant_id);
