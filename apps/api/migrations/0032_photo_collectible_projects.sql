-- 점주 사진 수집품. 원본·편집 자료는 비공개 project에만, 고객용 발행본은 허용 목록 snapshot에만 둔다.
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

CREATE TABLE collectible_publications (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL UNIQUE,
  merchant_id text NOT NULL,
  campaign_id text NOT NULL,
  project_version integer NOT NULL CHECK (project_version > 0),
  snapshots jsonb NOT NULL CHECK (jsonb_typeof(snapshots) = 'object'),
  reward_grades jsonb NOT NULL CHECK (jsonb_typeof(reward_grades) = 'object'),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, campaign_id),
  FOREIGN KEY (project_id, merchant_id) REFERENCES collectible_projects(id, merchant_id),
  FOREIGN KEY (campaign_id, merchant_id) REFERENCES campaigns(id, merchant_id)
);
ALTER TABLE collectible_projects ADD FOREIGN KEY (publication_id) REFERENCES collectible_publications(id);

CREATE TABLE campaign_collectible_publications (
  campaign_id text PRIMARY KEY REFERENCES campaigns(id),
  publication_id uuid NOT NULL,
  FOREIGN KEY (publication_id, campaign_id) REFERENCES collectible_publications(id, campaign_id)
);

CREATE TABLE collectible_acquisitions (
  entitlement_id uuid PRIMARY KEY REFERENCES reward_entitlements(id),
  publication_id uuid NOT NULL REFERENCES collectible_publications(id),
  grade_id text NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  acquired_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION collectible_publication_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'collectible publication is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER collectible_publication_immutable BEFORE UPDATE OR DELETE ON collectible_publications
  FOR EACH ROW EXECUTE FUNCTION collectible_publication_immutable();
CREATE TRIGGER collectible_acquisition_immutable BEFORE UPDATE OR DELETE ON collectible_acquisitions
  FOR EACH ROW EXECUTE FUNCTION collectible_publication_immutable();

-- 기존 1/3/5 보상권 INSERT 안에서만 현재 명시적 캠페인 발행본을 잡는다. 기존 권리에 소급 적용하지 않는다.
-- 캠페인 행의 SHARE 잠금은 점주의 발행 교체(UPDATE 잠금)와 직렬화되며, 기존 claim 트랜잭션과 함께 롤백된다.
CREATE FUNCTION capture_collectible_acquisition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE publication collectible_publications%ROWTYPE; selected_grade text; selected_snapshot jsonb;
BEGIN
  IF NEW.status NOT IN ('GRANTED', 'MINT_REQUESTED', 'FULFILLED') THEN RETURN NEW; END IF;
  PERFORM 1 FROM campaigns WHERE id = NEW.campaign_id FOR SHARE;
  SELECT p.* INTO publication FROM campaign_collectible_publications current
    JOIN collectible_publications p ON p.id = current.publication_id
    WHERE current.campaign_id = NEW.campaign_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  selected_grade := publication.reward_grades ->> NEW.target_visit_count::text;
  IF selected_grade IS NULL THEN RETURN NEW; END IF;
  selected_snapshot := publication.snapshots -> selected_grade;
  IF selected_snapshot IS NULL THEN RAISE EXCEPTION 'missing collectible grade snapshot'; END IF;
  INSERT INTO collectible_acquisitions (entitlement_id, publication_id, grade_id, snapshot)
    VALUES (NEW.id, publication.id, selected_grade, selected_snapshot);
  RETURN NEW;
END;
$$;
CREATE TRIGGER reward_entitlements_capture_collectible AFTER INSERT ON reward_entitlements
  FOR EACH ROW EXECUTE FUNCTION capture_collectible_acquisition();
