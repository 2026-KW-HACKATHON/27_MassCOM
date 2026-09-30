-- 비공개 원본의 중간 편집자와 복사 계보도 계정 삭제 대상에 포함한다. 고객 발행 snapshot에는 이 자료를 넣지 않는다.
CREATE TABLE collectible_project_contributors (
  project_id uuid NOT NULL REFERENCES collectible_projects(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  PRIMARY KEY (project_id, account_id)
);
CREATE INDEX collectible_project_contributors_account ON collectible_project_contributors (account_id, project_id);
INSERT INTO collectible_project_contributors (project_id, account_id)
  SELECT id, created_by_account_id FROM collectible_projects WHERE project IS NOT NULL AND created_by_account_id IS NOT NULL
  UNION SELECT id, edited_by_account_id FROM collectible_projects WHERE project IS NOT NULL AND edited_by_account_id IS NOT NULL;
