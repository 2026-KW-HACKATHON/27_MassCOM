-- Issue #253: 이용약관·개인정보 수집·이용에 동의한 계정과 그 버전·시각·경로를 기록한다.
-- 새 표 하나뿐이다. 배포된 API(02cb7e7)는 이 표를 읽거나 쓰지 않으므로 어떤 문장도 깨지지 않고, 롤백해도 표는 남아 무해하다.
-- 다른 브랜치의 migration 0032와 독립이며 기존 표·제약(platform_admin_audit_action_check 포함)에 손대지 않는다.

CREATE TABLE account_consents (
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  terms_version text NOT NULL CHECK (length(btrim(terms_version)) BETWEEN 1 AND 64),
  privacy_version text NOT NULL CHECK (length(btrim(privacy_version)) BETWEEN 1 AND 64),
  -- 만 14세 이상 확인은 true만 저장한다. 세 필수 항목 중 하나라도 거부하면 행이 생기지 않는다.
  age_confirmed boolean NOT NULL CHECK (age_confirmed),
  source text NOT NULL CHECK (source IN ('WEB', 'ANDROID', 'SHOWCASE_APP')),
  agreed_at timestamptz NOT NULL DEFAULT now(),
  -- 같은 버전 조합에 다시 동의해도 행이 늘지 않고(멱등), 버전이 바뀌면 새 행이 생겨 옛 행이 동의 이력으로 남는다.
  PRIMARY KEY (account_id, terms_version, privacy_version)
);

CREATE INDEX account_consents_agreed_at ON account_consents (agreed_at);
