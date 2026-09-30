-- 점주 사진 수집품. 원본·편집 자료는 비공개 project에만, 고객용 발행본은 허용 목록 등급 자료에만 둔다.
-- reward_entitlements 트리거와 campaigns·merchants·reward_entitlements FK가 운영 표의 잠금을 잡으므로 0032·0036처럼
-- 오래 기다리지 않고 실패하게 한다(실행기가 파일마다 BEGIN으로 감싸 이 파일에만 적용된다).
SET LOCAL lock_timeout = '5s';
CREATE TABLE collectible_projects (
  id uuid PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  created_by_account_id text,
  edited_by_account_id text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  project jsonb,
  publication_id uuid,
  -- 복사 계보: 처음 만든 프로젝트의 id. 복사본은 원본의 값을 물려받는다(중간 초안을 지워도 끊기지 않게 FK 없이 값만 둔다).
  lineage_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, merchant_id),
  CHECK (project IS NULL OR jsonb_typeof(project) = 'object'),
  CHECK ((status = 'DRAFT' AND publication_id IS NULL) OR (status = 'PUBLISHED' AND publication_id IS NOT NULL))
);
CREATE INDEX collectible_projects_merchant_list ON collectible_projects (merchant_id, updated_at DESC) WHERE project IS NOT NULL;
CREATE INDEX collectible_projects_lineage ON collectible_projects (merchant_id, lineage_id);

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
  -- NEW·OLD 필드는 표마다 다르므로 표 이름 검사와 필드 비교를 IF로 나눈다(plpgsql은 AND 단락 평가를 보장하지 않는다).
  IF TG_OP = 'UPDATE' AND current_setting('masscom.collectible_media_removal', true) = 'on' THEN
    IF TG_TABLE_NAME = 'collectible_publications' THEN
      IF OLD.media_removed_at IS NULL AND NEW.media_removed_at IS NOT NULL
         AND (to_jsonb(NEW) - 'media_removed_at') = (to_jsonb(OLD) - 'media_removed_at') THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'collectible_publication_grades' THEN
      IF NEW.publication_id = OLD.publication_id AND NEW.grade_id = OLD.grade_id THEN
        RETURN NEW;
      END IF;
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

-- 운영자 제거 절차(apps/api/README.md 참고): 대상 발행본의 원본 프로젝트와 같은 점포의 같은 복사 계보(lineage_id),
-- 그리고 그 계보의 원본 사진·음성과 같은 바이트를 쓰는 다른 프로젝트까지 모은다. 그 프로젝트들의 모든 발행본은 배포 연결을 끊고
-- 게시 미디어를 {"mediaRemoved":true} 표시로 바꾸며, 프로젝트의 비공개 원본·작성자 식별자·기여자 행을 지운다.
-- 이미 획득한 고객의 도감에서는 이 수집품 외형이 사라지고(보상·방문 기록은 그대로) 상세는 404가 된다.
-- 반환: 미디어를 비운 발행본 id와 그 등급 행 수(대상 발행본을 포함한 계보 전체).
CREATE FUNCTION collectible_remove_publication_media(target uuid)
RETURNS TABLE (removed_publication_id uuid, cleared_grades integer) LANGUAGE plpgsql AS $$
DECLARE store text; lineage uuid; affected_projects uuid[]; affected uuid[]; item uuid;
BEGIN
  SELECT source.merchant_id, source.lineage_id INTO store, lineage
    FROM collectible_publications publication JOIN collectible_projects source ON source.id = publication.project_id
    WHERE publication.id = target;
  IF store IS NULL THEN RAISE EXCEPTION 'collectible publication % not found', target USING ERRCODE = 'P0002'; END IF;
  -- 복사·게시·삭제와 같은 점포 잠금: 모으는 사이에 새 복사본이 생기지 않는다.
  PERFORM pg_advisory_xact_lock(hashtextextended('collectible-sources:' || store, 0));
  WITH lineage_projects AS (
    SELECT id, project FROM collectible_projects WHERE merchant_id = store AND lineage_id = lineage
  ), media AS (
    SELECT project->'photo'->>'originalDataUrl' AS value FROM lineage_projects WHERE project->'photo'->>'originalDataUrl' <> ''
    UNION SELECT project->'audio'->>'dataUrl' FROM lineage_projects WHERE project->'audio'->>'dataUrl' IS NOT NULL
  )
  SELECT array_agg(candidate.id ORDER BY candidate.id) INTO affected_projects FROM collectible_projects candidate
    WHERE candidate.merchant_id = store AND (candidate.lineage_id = lineage
      OR candidate.project->'photo'->>'originalDataUrl' IN (SELECT value FROM media)
      OR candidate.project->'audio'->>'dataUrl' IN (SELECT value FROM media));
  SELECT coalesce(array_agg(publication.id ORDER BY publication.id), '{}') INTO affected
    FROM collectible_publications publication WHERE publication.project_id = ANY(affected_projects);
  PERFORM set_config('masscom.collectible_media_removal', 'on', true);
  DELETE FROM campaign_collectible_publications link WHERE link.publication_id = ANY(affected);
  UPDATE collectible_publications SET media_removed_at = now() WHERE id = ANY(affected) AND media_removed_at IS NULL;
  FOREACH item IN ARRAY affected LOOP
    UPDATE collectible_publication_grades grade
      SET summary = jsonb_build_object('gradeId', grade.grade_id, 'mediaRemoved', true), detail = jsonb_build_object('mediaRemoved', true)
      WHERE grade.publication_id = item;
    GET DIAGNOSTICS cleared_grades = ROW_COUNT;
    removed_publication_id := item;
    RETURN NEXT;
  END LOOP;
  -- 기여자 표는 0035에서 만든다(plpgsql은 실행할 때 이름을 찾는다).
  DELETE FROM collectible_project_contributors contributor WHERE contributor.project_id = ANY(affected_projects);
  UPDATE collectible_projects SET project = NULL, created_by_account_id = NULL, edited_by_account_id = NULL, updated_at = now()
    WHERE id = ANY(affected_projects);
  PERFORM set_config('masscom.collectible_media_removal', 'off', true);
END;
$$;
