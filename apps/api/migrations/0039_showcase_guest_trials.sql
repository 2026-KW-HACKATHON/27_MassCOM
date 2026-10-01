-- Issue #309: 로그인 없는 시연 웹 체험. 체험 계정마다 개인 체험 가게 하나와 24시간 세션을 만든다.
-- 0037처럼 migration은 운영 DB에도 그대로 돌아 빈 표만 만든다(스키마 분기 없음). 쓰기는 API가 시연 배치에서만 연다.
CREATE TABLE showcase_guest_trials (
  account_id text PRIMARY KEY CHECK (btrim(account_id) <> ''),
  merchant_id text NOT NULL UNIQUE REFERENCES merchants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  -- 시작한 클라이언트 IP의 HMAC-SHA-256(원래 IP는 저장하지 않는다). 한 IP가 동시 체험 자리를 독차지하지 못하게 세는 데만 쓰고,
  -- 체험이 끝나거나 계정이 지워지면 NULL로 지운다.
  client_key_hash bytea CHECK (client_key_hash IS NULL OR octet_length(client_key_hash) = 32),
  CHECK (expires_at > created_at),
  CHECK (ended_at IS NULL OR client_key_hash IS NULL)
);

-- 동시 체험자 수 세기와 만료 정리가 끝나지 않은 행만 본다.
CREATE INDEX showcase_guest_trials_active_expiry
  ON showcase_guest_trials (expires_at) WHERE ended_at IS NULL;

CREATE INDEX showcase_guest_trials_active_client
  ON showcase_guest_trials (client_key_hash) WHERE ended_at IS NULL;
