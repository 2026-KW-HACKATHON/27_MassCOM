-- Issue #412 (D-092): 점주 목적형 캠페인(새 손님 만나기·다시 방문하게 하기·한산한 시간대 채우기)과 시간대 조건.
-- 추가만 한다(새 표·함수·트리거와 감사 action 하나). 기존 표의 열·제약·데이터를 바꾸지 않으므로 이전 API 이미지가 그대로 동작한다.
-- 목적 행이 없는 캠페인(기존 캠페인 전부)은 지금과 똑같이 동작한다. 롤백 때 이 표를 지우지 않는다(새 API가 남긴 행은 이전 API가 읽지 않을 뿐이다).

-- 실행기가 파일마다 BEGIN … COMMIT으로 감싼다. 운영 표(campaigns·platform_admin_audit)의 잠금 대기는 5초에서 포기한다.
SET LOCAL lock_timeout = '5s';

-- 시간대 jsonb 검사. CHECK는 하위 질의를 쓸 수 없어 함수로 둔다(입력만 보므로 IMMUTABLE).
-- 모양: 1~3개의 {days:[ISO 요일 1~7, 중복 없음], start:"HH:MM", end:"HH:MM"}, 한국 시간, 시작 포함·끝 제외, 자정을 넘기지 않는다.
-- 끝에만 "24:00"(그날 끝까지)을 쓸 수 있다.
CREATE FUNCTION campaign_time_windows_valid(windows jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  entry jsonb;
  day jsonb;
  seen integer[];
BEGIN
  IF jsonb_typeof(windows) IS DISTINCT FROM 'array' OR jsonb_array_length(windows) NOT BETWEEN 1 AND 3 THEN
    RETURN false;
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(windows) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(entry)) <> 3
       OR NOT (entry ?& ARRAY['days', 'start', 'end'])
       OR jsonb_typeof(entry -> 'days') IS DISTINCT FROM 'array'
       OR jsonb_typeof(entry -> 'start') IS DISTINCT FROM 'string'
       OR jsonb_typeof(entry -> 'end') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
    IF jsonb_array_length(entry -> 'days') NOT BETWEEN 1 AND 7 THEN RETURN false; END IF;
    seen := ARRAY[]::integer[];
    FOR day IN SELECT value FROM jsonb_array_elements(entry -> 'days') LOOP
      IF jsonb_typeof(day) IS DISTINCT FROM 'number' OR (day #>> '{}') !~ '^[1-7]$' THEN RETURN false; END IF;
      IF (day #>> '{}')::integer = ANY (seen) THEN RETURN false; END IF;
      seen := seen || (day #>> '{}')::integer;
    END LOOP;
    IF (entry ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR (entry ->> 'end') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
       OR (entry ->> 'end') COLLATE "C" <= (entry ->> 'start') COLLATE "C" THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE TABLE campaign_purposes (
  campaign_id text PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('NEW_CUSTOMERS', 'REVISIT', 'OFF_PEAK')),
  -- 점주가 밀고 싶은 대표 메뉴 이름(메뉴 정보가 있으면 API가 그 가게 메뉴와 맞는지 확인한다).
  featured_menu_name text CHECK (featured_menu_name IS NULL OR char_length(btrim(featured_menu_name)) BETWEEN 1 AND 40),
  -- 다시 방문하게 하기: 첫 방문 뒤 최소 며칠, 며칠 안에 다시 오면 재방문으로 보는지. 다른 목적에서는 쓰지 않고 기본값으로 둔다.
  revisit_min_days integer NOT NULL DEFAULT 1 CHECK (revisit_min_days BETWEEN 1 AND 30),
  revisit_window_days integer NOT NULL DEFAULT 14 CHECK (revisit_window_days BETWEEN 2 AND 60),
  next_step_text text CHECK (next_step_text IS NULL OR char_length(btrim(next_step_text)) BETWEEN 1 AND 80),
  -- 한산한 시간대 채우기에서만 쓴다. 한국 시간, 시작 포함·끝 제외.
  time_windows jsonb CHECK (time_windows IS NULL OR campaign_time_windows_valid(time_windows)),
  -- 점주가 확인한 가게 소개. 글·확인 기록 참조 번호·확인 시각은 함께 있거나 함께 없다. 게시 뒤에도 바꿀 수 있는 것은 이 셋뿐이다.
  intro_text text CHECK (intro_text IS NULL OR char_length(btrim(intro_text)) BETWEEN 1 AND 200),
  intro_verified_ref text CHECK (
    intro_verified_ref IS NULL OR (
      intro_verified_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$'
      AND regexp_replace(intro_verified_ref, '[^A-Za-z0-9]', '', 'g') !~ '[0-9]{8}'
    )
  ),
  intro_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_purposes_revisit_days_order CHECK (revisit_min_days < revisit_window_days),
  CONSTRAINT campaign_purposes_windows_iff_off_peak CHECK ((purpose = 'OFF_PEAK') = (time_windows IS NOT NULL)),
  CONSTRAINT campaign_purposes_next_step_revisit_only CHECK (next_step_text IS NULL OR purpose = 'REVISIT'),
  CONSTRAINT campaign_purposes_intro_all_or_none CHECK (
    (intro_text IS NULL) = (intro_verified_ref IS NULL) AND (intro_text IS NULL) = (intro_verified_at IS NULL)
  )
);

-- 캠페인이 초안(DRAFT)인 동안에만 목적 행을 만들거나 고칠 수 있다. 공개·중지·종료된 뒤에는 조건(목적·시간대·대표 메뉴 …)을
-- 사후에 바꾸지 않고, intro_* 세 칸만 바꿀 수 있다. coin_series_terms_guard(0059)와 같은 모양이다.
-- 캠페인 행을 FOR SHARE로 잠가 공개(DRAFT -> ACTIVE)와 동시에 일어나는 수정이 공개 뒤로 새지 않게 한다.
CREATE FUNCTION campaign_purposes_terms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  campaign_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO campaign_status FROM campaigns WHERE id = NEW.campaign_id FOR SHARE;
    -- 캠페인이 없으면 외래 키가 거절한다.
    IF campaign_status IS NULL OR campaign_status = 'DRAFT' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'campaign purpose can only be set while the campaign is a draft' USING ERRCODE = '23514';
  END IF;
  -- 목적 행을 다른 캠페인으로 옮기는 것은 막는다. 초안 행을 공개된 캠페인에 붙이면 공개 뒤 조건을 사후에 심는 길이 된다.
  IF TG_OP = 'UPDATE' AND NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN
    RAISE EXCEPTION 'campaign purpose cannot be moved to another campaign' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO campaign_status FROM campaigns WHERE id = OLD.campaign_id FOR SHARE;
  IF TG_OP = 'DELETE' THEN
    -- 캠페인 삭제로 이어진 연쇄 삭제에서는 캠페인 행이 이미 보이지 않는다.
    IF campaign_status IS NULL OR campaign_status = 'DRAFT' THEN RETURN OLD; END IF;
  ELSIF campaign_status = 'DRAFT' THEN
    RETURN NEW;
  ELSIF (to_jsonb(NEW) - 'intro_text' - 'intro_verified_ref' - 'intro_verified_at')
      = (to_jsonb(OLD) - 'intro_text' - 'intro_verified_ref' - 'intro_verified_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'campaign purpose terms are immutable after the campaign leaves draft' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER campaign_purposes_terms_immutable BEFORE INSERT OR UPDATE OR DELETE ON campaign_purposes
  FOR EACH ROW EXECUTE FUNCTION campaign_purposes_terms_guard();

-- 감사 action 하나를 더한다. 0043의 16개 전체를 이어받고 CAMPAIGN_PURPOSE_SET만 보탠다(17개). 다음 확장도 이 17개 전체를 이어받아야 한다.
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
    'CAMPAIGN_EXTENDED', 'CAMPAIGN_PURPOSE_SET'
  )) NOT VALID;
