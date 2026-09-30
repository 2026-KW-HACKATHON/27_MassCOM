-- 점주 사진 수집품. 원본·편집 자료는 비공개 project에만, 고객용 발행본은 허용 목록 등급 자료에만 둔다.
CREATE TABLE collectible_projects (
  id uuid PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  created_by_account_id text,
  edited_by_account_id text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  project jsonb,
  publication_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, merchant_id),
  CHECK (project IS NULL OR jsonb_typeof(project) = 'object'),
  CHECK ((status = 'DRAFT' AND publication_id IS NULL) OR (status = 'PUBLISHED' AND publication_id IS NOT NULL))
);
CREATE INDEX collectible_projects_merchant_list ON collectible_projects (merchant_id, updated_at DESC) WHERE project IS NOT NULL;

-- 발행본은 불변이다. 등급별 자료는 가벼운 목록 요약(summary: 이름·등급·모양·시즌·썸네일)과
-- 상세 재생 자료(detail: 완성 이미지·마스크·음성·장면 등)를 나눠, 도감 목록이 상세 미디어를 풀지 않게 한다.
-- media_removed_at은 운영자 제거 절차(collectible_remove_publication_media)만 채운다.
CREATE TABLE collectible_publications (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL UNIQUE,
  merchant_id text NOT NULL,
  campaign_id text NOT NULL,
  project_version integer NOT NULL CHECK (project_version > 0),
  reward_grades jsonb NOT NULL CHECK (jsonb_typeof(reward_grades) = 'object'),
  published_at timestamptz NOT NULL DEFAULT now(),
  media_removed_at timestamptz,
  UNIQUE (id, campaign_id),
  FOREIGN KEY (project_id, merchant_id) REFERENCES collectible_projects(id, merchant_id),
  FOREIGN KEY (campaign_id, merchant_id) REFERENCES campaigns(id, merchant_id)
);
ALTER TABLE collectible_projects ADD FOREIGN KEY (publication_id) REFERENCES collectible_publications(id);

CREATE TABLE collectible_publication_grades (
  publication_id uuid NOT NULL REFERENCES collectible_publications(id),
  grade_id text NOT NULL,
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  PRIMARY KEY (publication_id, grade_id)
);

CREATE TABLE campaign_collectible_publications (
  campaign_id text PRIMARY KEY REFERENCES campaigns(id),
  publication_id uuid NOT NULL,
  FOREIGN KEY (publication_id, campaign_id) REFERENCES collectible_publications(id, campaign_id)
);
CREATE INDEX campaign_collectible_publications_publication ON campaign_collectible_publications (publication_id);

-- 고객 획득은 참조만 남긴다. 발행본 등급 행이 불변이므로 "획득 당시 버전"은 이 참조로 보존된다.
CREATE TABLE collectible_acquisitions (
  entitlement_id uuid PRIMARY KEY REFERENCES reward_entitlements(id),
  publication_id uuid NOT NULL,
  grade_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (publication_id, grade_id) REFERENCES collectible_publication_grades(publication_id, grade_id)
);
CREATE INDEX collectible_acquisitions_publication ON collectible_acquisitions (publication_id, grade_id);

CREATE FUNCTION collectible_publication_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'collectible publication is immutable' USING ERRCODE = '23514';
END;
$$;

-- 운영자 제거만 허용한다: 세션 설정 masscom.collectible_media_removal = 'on'인 거래에서
-- 발행본은 media_removed_at을 NULL에서 값으로 바꾸는 UPDATE만, 등급 행은 키를 유지한 summary·detail UPDATE만 통과한다.
CREATE FUNCTION collectible_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('masscom.collectible_media_removal', true) = 'on' THEN
    IF TG_TABLE_NAME = 'collectible_publications'
       AND OLD.media_removed_at IS NULL AND NEW.media_removed_at IS NOT NULL
       AND (to_jsonb(NEW) - 'media_removed_at') = (to_jsonb(OLD) - 'media_removed_at') THEN
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'collectible_publication_grades'
       AND NEW.publication_id = OLD.publication_id AND NEW.grade_id = OLD.grade_id THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'collectible publication is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER collectible_publication_immutable BEFORE UPDATE OR DELETE ON collectible_publications
  FOR EACH ROW EXECUTE FUNCTION collectible_publication_guard();
CREATE TRIGGER collectible_publication_grade_immutable BEFORE UPDATE OR DELETE ON collectible_publication_grades
  FOR EACH ROW EXECUTE FUNCTION collectible_publication_guard();
CREATE TRIGGER collectible_acquisition_immutable BEFORE UPDATE OR DELETE ON collectible_acquisitions
  FOR EACH ROW EXECUTE FUNCTION collectible_publication_immutable();

-- 기존 1/3/5 보상권 INSERT 안에서만 현재 명시적 캠페인 발행본을 참조로 잡는다. 기존 권리에 소급 적용하지 않는다.
-- 연결이 있을 때만 캠페인 행을 FOR KEY SHARE로 잠근다: 발행 교체·게시 중지(FOR UPDATE)와는 직렬화되고
-- 참여 정원 UPDATE나 관리자 공개·중지와는 경합하지 않는다. 잠금을 얻은 뒤 연결을 다시 읽어 교체 결과를 본다.
-- 등급 자료가 없으면 수집품만 건너뛴다(경고만 남김): 수집품 연출은 보상 생성의 성공 조건이 아니다.
CREATE FUNCTION capture_collectible_acquisition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked uuid; selected_grade text; publication_rewards jsonb;
BEGIN
  IF NEW.status NOT IN ('GRANTED', 'MINT_REQUESTED', 'FULFILLED') THEN RETURN NEW; END IF;
  PERFORM 1 FROM campaign_collectible_publications WHERE campaign_id = NEW.campaign_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM 1 FROM campaigns WHERE id = NEW.campaign_id FOR KEY SHARE;
  SELECT p.id, p.reward_grades INTO linked, publication_rewards
    FROM campaign_collectible_publications current
    JOIN collectible_publications p ON p.id = current.publication_id
    WHERE current.campaign_id = NEW.campaign_id AND p.media_removed_at IS NULL;
  IF linked IS NULL THEN RETURN NEW; END IF;
  selected_grade := publication_rewards ->> NEW.target_visit_count::text;
  IF selected_grade IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM collectible_publication_grades WHERE publication_id = linked AND grade_id = selected_grade;
  IF NOT FOUND THEN
    RAISE WARNING 'collectible grade % missing for publication %; reward kept without collectible', selected_grade, linked;
    RETURN NEW;
  END IF;
  INSERT INTO collectible_acquisitions (entitlement_id, publication_id, grade_id)
    VALUES (NEW.id, linked, selected_grade);
  RETURN NEW;
END;
$$;
CREATE TRIGGER reward_entitlements_capture_collectible AFTER INSERT ON reward_entitlements
  FOR EACH ROW EXECUTE FUNCTION capture_collectible_acquisition();

-- 운영자 제거 절차(apps/api/README.md 참고): 발행본의 게시 미디어를 비우고 배포 연결을 끊고 원본 프로젝트 자료를 지운다.
-- 이미 획득한 고객의 도감에서는 이 수집품 외형이 사라지고(보상·방문 기록은 그대로) 상세는 404가 된다.
CREATE FUNCTION collectible_remove_publication_media(target uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE removed integer;
BEGIN
  PERFORM set_config('masscom.collectible_media_removal', 'on', true);
  DELETE FROM campaign_collectible_publications WHERE publication_id = target;
  UPDATE collectible_publications SET media_removed_at = now() WHERE id = target AND media_removed_at IS NULL;
  UPDATE collectible_publication_grades
    SET summary = jsonb_build_object('gradeId', grade_id, 'mediaRemoved', true),
        detail = jsonb_build_object('mediaRemoved', true)
    WHERE publication_id = target;
  GET DIAGNOSTICS removed = ROW_COUNT;
  -- 기여자 표는 0035에서 만든다(plpgsql은 실행할 때 이름을 찾는다).
  DELETE FROM collectible_project_contributors
    WHERE project_id IN (SELECT id FROM collectible_projects WHERE publication_id = target);
  UPDATE collectible_projects SET project = NULL, created_by_account_id = NULL, edited_by_account_id = NULL, updated_at = now()
    WHERE publication_id = target;
  PERFORM set_config('masscom.collectible_media_removal', 'off', true);
  RETURN removed;
END;
$$;
