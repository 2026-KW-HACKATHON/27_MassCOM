-- 가게 사이를 잇는 코스 (Issue #412, D-093). 추가 전용이다: 새 표 3개와 감사 action 4개만 더하고
-- 방문·보상권·코인 표(visit_events, reward_entitlements, collectible_*, coin_*)와 그 트리거는 건드리지 않는다.
-- 코스 진행은 reward_entitlements를 읽어 서버가 계산하며, 이 표들은 "어떤 코스인지"와 "열어 본 기록"만 저장한다.
-- 이전 API는 이 표를 쓰지 않으므로 먼저 적용하거나 이전 이미지로 롤백해도 기존 쓰기를 그대로 허용한다.
-- 0068–0071은 열린 다른 PR의 번호라 비어 있다. migration 실행기는 번호가 이어져야 한다고 요구하지 않는다.

-- 실행기가 파일마다 BEGIN … COMMIT으로 감싼다. 운영 표의 잠금 대기는 5초에서 포기한다.
SET LOCAL lock_timeout = '5s';

CREATE TABLE courses (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 40),
  -- 방문 상황. 문구는 앱·API가 이 값으로 만든다(AFTER_MEAL=식사 후 들르기 좋은 곳, TAKEOUT=포장해서 가져가기 좋은 곳).
  situation text NOT NULL CHECK (situation IN ('AFTER_MEAL', 'TAKEOUT', 'OTHER')),
  -- 팀이 만든 장면 틀의 이름. v1 장면 화면은 이 키 이름과 각 가게의 자기 코인 썸네일만 보여 준다(새 그림을 만들지 않는다).
  scene_key text NOT NULL CHECK (scene_key ~ '^[a-z0-9-]{1,40}$'),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED')),
  starts_at timestamptz,
  ends_at timestamptz,
  curated_by_account_id text NOT NULL CHECK (length(btrim(curated_by_account_id)) > 0),
  -- 마지막 점검 시각과 그 시점의 스냅샷(직선거리·영업시간·업종 조합 등). 지금 상태가 아니라 점검한 순간의 기록이다.
  checked_at timestamptz,
  check_summary jsonb CHECK (check_summary IS NULL OR jsonb_typeof(check_summary) = 'object'),
  -- NULL이면 게시 전 방문도 센다. 값이 있으면 그 시각 이후에 받은 보상권만 센다.
  counts_from timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CHECK ((checked_at IS NULL) = (check_summary IS NULL))
);
CREATE INDEX courses_active ON courses (starts_at, ends_at) WHERE status = 'ACTIVE';

CREATE TABLE course_steps (
  course_id uuid NOT NULL REFERENCES courses(id),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 4),
  merchant_id text NOT NULL REFERENCES merchants(id),
  target_visit_count integer NOT NULL DEFAULT 1 CHECK (target_visit_count IN (1, 3, 5)),
  piece_key text NOT NULL CHECK (piece_key ~ '^[a-z0-9-]{1,40}$'),
  piece_label text NOT NULL CHECK (char_length(btrim(piece_label)) BETWEEN 1 AND 20),
  -- 점주가 이 코스에 넣는 데 동의했다는 문서 참조 번호(0059 consent_document_ref와 같은 형식, 8자리 숫자열 제외).
  -- 게시하려면 모든 단계에 있어야 한다. 개인정보를 받지 않고 참조 번호만 둔다.
  owner_optin_ref text CHECK (
    owner_optin_ref IS NULL OR (
      owner_optin_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$'
      AND regexp_replace(owner_optin_ref, '[^A-Za-z0-9]', '', 'g') !~ '[0-9]{8}'
    )
  ),
  owner_optin_at timestamptz,
  PRIMARY KEY (course_id, position),
  UNIQUE (course_id, merchant_id),
  UNIQUE (course_id, piece_key),
  CHECK ((owner_optin_ref IS NULL) = (owner_optin_at IS NULL))
);
CREATE INDEX course_steps_merchant ON course_steps (merchant_id);

CREATE TABLE course_unlocks (
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  course_id uuid NOT NULL REFERENCES courses(id),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  -- 열 때 서버가 확인한 단계별 보상권 id. 클라이언트가 완료를 주장하는 값은 저장하지 않는다.
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  -- 운영자가 무효로 돌릴 때만 쓴다. v1 API는 쓰지 않고, 단계가 다시 모자라면 읽을 때 stale로 표시한다.
  revoked_at timestamptz,
  PRIMARY KEY (account_id, course_id)
);
CREATE INDEX course_unlocks_course ON course_unlocks (course_id);

-- 게시된 코스의 조건(제목·상황·장면·기간·센 기준 시각)은 바꿀 수 없다. 손님이 보고 진행한 조건을 사후에 바꾸지 않는다.
-- 바꿀 수 있는 것은 상태(ACTIVE↔PAUSED, 종료), 새 점검 스냅샷, 계정 삭제 때의 큐레이터 가명 처리뿐이다.
-- 초안은 자유롭게 고치고 지울 수 있다. 게시(ACTIVE로 전환)는 단계 2–4개가 1부터 이어져 있고, 모두 점주 동의 참조가 있고,
-- 점검 스냅샷이 있을 때만 DB가 허용한다(서비스 검사를 우회하는 직접 쓰기도 막는다).
CREATE FUNCTION courses_terms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  steps integer;
  last_position integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'published course cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'ACTIVE' AND OLD.status <> 'ACTIVE' THEN
    SELECT count(*), coalesce(max(position), 0) INTO steps, last_position FROM course_steps WHERE course_id = NEW.id;
    IF steps NOT BETWEEN 2 AND 4 OR last_position <> steps OR NEW.checked_at IS NULL
       OR EXISTS (SELECT 1 FROM course_steps WHERE course_id = NEW.id AND owner_optin_ref IS NULL) THEN
      RAISE EXCEPTION 'course is not publishable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.status = 'DRAFT' THEN
    IF NEW.status IN ('DRAFT', 'ACTIVE') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'course terms are immutable' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'checked_at' - 'check_summary' - 'curated_by_account_id')
       = (to_jsonb(OLD) - 'status' - 'checked_at' - 'check_summary' - 'curated_by_account_id')
     AND (NEW.status = OLD.status
       OR (OLD.status = 'ACTIVE' AND NEW.status IN ('PAUSED', 'ENDED'))
       OR (OLD.status = 'PAUSED' AND NEW.status IN ('ACTIVE', 'ENDED'))) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'course terms are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER courses_terms_immutable BEFORE UPDATE OR DELETE ON courses
  FOR EACH ROW EXECUTE FUNCTION courses_terms_guard();

-- 단계는 초안일 때만 만들고 고치고 지울 수 있다. 게시된(ACTIVE·PAUSED·ENDED) 코스의 단계는 바꿀 수 없다.
-- 부모 행을 FOR SHARE로 읽어, 게시 전환과 단계 추가가 동시에 오면 한쪽이 기다린 뒤 게시된 상태를 보고 거절된다.
CREATE FUNCTION course_steps_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.course_id <> OLD.course_id THEN
    RAISE EXCEPTION 'course steps cannot move between courses' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO parent_status FROM courses WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.course_id ELSE NEW.course_id END FOR SHARE;
  IF parent_status IS NULL OR parent_status = 'DRAFT' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'course steps are immutable once published' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER course_steps_immutable BEFORE INSERT OR UPDATE OR DELETE ON course_steps
  FOR EACH ROW EXECUTE FUNCTION course_steps_guard();

-- 0043의 16개 action과 선행 PR 0068의 CAMPAIGN_PURPOSE_SET에 코스 4개를 더한다.
-- 0068 이후 적용할 때 CAMPAIGN_PURPOSE_SET을 잃지 않도록 전체 union을 유지한다.
-- 코스 감사는 단계에 든 가게마다 한 행씩 남긴다(merchant_id가 NOT NULL이고 점포별로 조회하기 때문). 코스 전체는 after_state에 있다.
-- 기존 행은 더 좁은 0043 CHECK를 이미 만족한다. NOT VALID로 재검사를 생략해 잠금을 짧게 유지하고 새 쓰기에는 즉시 적용한다.
ALTER TABLE platform_admin_audit
  DROP CONSTRAINT platform_admin_audit_action_check;

ALTER TABLE platform_admin_audit
  ADD CONSTRAINT platform_admin_audit_action_check
  CHECK (action IN (
    'MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN', 'CAMPAIGN_DRAFT_CREATED', 'COUPON_VOIDED',
    'ACCOUNT_DELETION_PROCESSED', 'ACCOUNT_DELETION_REJECTED', 'ACCOUNT_DELETION_RECONCILED',
    'MERCHANT_PUBLISHED', 'MERCHANT_OWNER_GRANTED', 'MERCHANT_OWNER_REVOKED',
    'REWARD_OFFER_CREATED', 'REWARD_OFFER_PAUSED', 'CAMPAIGN_PUBLISHED', 'CAMPAIGN_PAUSED',
    'CAMPAIGN_EXTENDED', 'CAMPAIGN_PURPOSE_SET', 'CAMPAIGN_BENEFIT_CREATED', 'CAMPAIGN_BENEFIT_PAUSED',
    'COURSE_CREATED', 'COURSE_CHECKED', 'COURSE_PUBLISHED', 'COURSE_PAUSED'
  )) NOT VALID;
