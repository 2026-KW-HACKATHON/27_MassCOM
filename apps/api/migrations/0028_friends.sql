-- 친구(Issue #230, D-047): 별명·친구 코드·친구 관계·차단·코드 입력 실패 기록. 추가형이며 기존 표를 바꾸지 않는다.
-- 계정 ID는 다른 표와 같은 text이고 참조 제약은 두지 않는다. 계정 삭제는 account-deletion.ts가 같은 거래에서 지운다.
CREATE TABLE explorer_profiles (
  account_id text PRIMARY KEY CHECK (length(btrim(account_id)) > 0),
  nickname text NOT NULL CHECK (char_length(btrim(nickname)) BETWEEN 1 AND 12),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 헷갈리는 글자(0·O·1·I)를 뺀 32글자 표에서 고른 8자리. 바꾸면 옛 코드는 행이 바뀌며 즉시 무효가 된다.
CREATE TABLE friend_codes (
  account_id text PRIMARY KEY CHECK (length(btrim(account_id)) > 0),
  code text NOT NULL UNIQUE CHECK (code ~ '^[2-9A-HJ-NP-Z]{8}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

-- 한 쌍에 한 행. 정렬은 바이트 순서("C" 정렬)로 고정해 DB 기본 정렬 규칙과 상관없이 앱의 정렬과 같다.
-- 화면·API에는 id만 보이고 상대 계정 ID는 보이지 않는다.
CREATE TABLE friendships (
  id uuid PRIMARY KEY,
  account_low text NOT NULL CHECK (length(btrim(account_low)) > 0),
  account_high text NOT NULL CHECK (length(btrim(account_high)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friendships_pair_unique UNIQUE (account_low, account_high),
  CONSTRAINT friendships_pair_ordered CHECK (account_low COLLATE "C" < account_high COLLATE "C")
);

-- account_low 조회는 위의 유일 제약이 받치고, account_high 조회와 계정 삭제 정리는 이 색인이 받친다.
CREATE INDEX friendships_account_high_idx ON friendships (account_high);

-- 친구를 끊으면 끊은 쪽(blocker)이 상대(blocked)를 막는다. 막힌 계정이 끊은 사람의 코드를 입력하면 없는 코드와 같은 404이고
-- 실패 횟수에 들어간다. 끊은 쪽이 나중에 상대의 코드로 다시 추가하면 같은 거래에서 풀린다. 코드가 아니라 계정 기준이라
-- 코드를 바꿔도 유지된다. blocked 색인은 계정 삭제 정리가 받친다(blocker 조회는 기본 키가 받친다).
CREATE TABLE friend_blocks (
  blocker text NOT NULL CHECK (length(btrim(blocker)) > 0),
  blocked text NOT NULL CHECK (length(btrim(blocked)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker, blocked),
  CONSTRAINT friend_blocks_distinct CHECK (blocker <> blocked)
);

CREATE INDEX friend_blocks_blocked_idx ON friend_blocks (blocked);

-- 코드 입력 실패만 기록한다(계정당 10분 10회 제한). 성공·멱등 재요청은 기록하지 않는다.
CREATE TABLE friend_code_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id text NOT NULL CHECK (length(btrim(account_id)) > 0),
  attempted_at timestamptz NOT NULL
);

CREATE INDEX friend_code_attempts_account_time_idx
  ON friend_code_attempts (account_id, attempted_at);
