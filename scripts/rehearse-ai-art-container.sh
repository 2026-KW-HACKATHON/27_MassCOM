#!/usr/bin/env bash
# 사장님 AI 가게 그림 "켜진 상태" 컨테이너 리허설(Issue #256). 배포와 같은 Dockerfile(infra/lightsail/api.Dockerfile)로 만든 API 이미지를
# 가짜 키와 가짜 OpenAI 서버(scripts/fake-openai-images.mjs)에 붙여, 실제 키·실제 호출 없이 켜진 상태의 흐름과 오류 처리를 확인한다.
#
#   bash scripts/rehearse-ai-art-container.sh
#
# 필요한 것: docker, 이미 실행 중인 로컬 PostgreSQL 컨테이너(기본 masscom-sky-qa-pg, 계정 postgres, 루프백 trust 접속).
# 이 스크립트는 그 서버 안에 자기 DB `masscom_256_test` 하나만 만들고 끝나면 지운다. API·가짜 서버·구동기 컨테이너는 모두 그 PostgreSQL
# 컨테이너의 네트워크(`--network container:`)를 함께 써서 127.0.0.1로 서로 만난다: API는 DB를 127.0.0.1:5432로, 가짜 OpenAI를
# AI_ART_OPENAI_BASE_URL=http://127.0.0.1:<포트>로 부른다(api.openai.com은 어떤 경로로도 부르지 않는다). 키는 명백한 가짜 값이다.
#
# 시나리오마다 API와 가짜 서버를 새로 띄워 기동 로그·요청 횟수·비용 기록(ai_art_spend)을 시나리오별로 센다. 모두 PASS이면 종료 코드 0.
#
# 환경 변수(선택)
#   REHEARSAL_PG_CONTAINER   PostgreSQL 컨테이너 이름(기본 masscom-sky-qa-pg)
#   REHEARSAL_SKIP_BUILD=1   이미 만든 이미지를 그대로 쓴다(REHEARSAL_IMAGE로 이름 지정, 기본 masscom-256-rehearsal:local)
#   REHEARSAL_KEEP_IMAGE=1   끝난 뒤 직접 만든 이미지를 지우지 않는다
#   REHEARSAL_RESULT_FILE    결과 표(탭 구분: 판정, 시나리오, 확인, 상세)를 이 파일에도 쓴다
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
pg="${REHEARSAL_PG_CONTAINER:-masscom-sky-qa-pg}"
db=masscom_256_test
image="${REHEARSAL_IMAGE:-masscom-256-rehearsal:local}"
api_name="masscom-256-rehearsal-api-$$"
fake_name="masscom-256-rehearsal-fake-$$"
label='masscom.rehearsal=256'
api_port=$((31000 + RANDOM % 2000))
fake_port=$((api_port + 2000))
fake_key='fake-rehearsal-key-not-a-real-openai-key'
merchant=rehearsal-merchant
unit_draft=8760      # 시안 한 장의 실제 비용(µUSD): 텍스트 120×5 + 출력 272×30 (가짜 서버의 usage 기준)
unit_final=100900    # 최종 한 장: 텍스트 100×5 + 이미지 입력 1300×8 + 출력 3000×30
scratch="$(mktemp -d -t masscom-256-rehearsal.XXXXXX)"
built_image=0
db_created=0
results="$scratch/results.tsv"
: >"$results"
failed=0

fail_setup() {
  echo "rehearsal BLOCKED: $1" >&2
  exit 2
}

remove_containers() {
  local ids
  ids="$(docker ps -aq --filter "label=$label" 2>/dev/null || true)"
  if [[ -n "$ids" ]]; then
    # shellcheck disable=SC2086
    docker rm -f $ids >/dev/null 2>&1 || true
  fi
}

cleanup() {
  remove_containers
  if [[ "$db_created" == 1 ]]; then
    docker exec "$pg" psql -U postgres -d postgres -X -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  if [[ "$built_image" == 1 && "${REHEARSAL_KEEP_IMAGE:-0}" != 1 ]]; then
    docker rmi "$image" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT

psql_db() { docker exec -i "$pg" psql -U postgres -d "$db" -X -q -v ON_ERROR_STOP=1 "$@"; }

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
  else printf '%s' "$1" | sha256sum | cut -d' ' -f1; fi
}

record() { # 판정 시나리오 확인 상세
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >>"$results"
  if [[ "$1" == FAIL ]]; then failed=$((failed + 1)); fi
  printf '  %-4s %-22s %s%s\n' "$1" "$2" "$3" "${4:+ ($4)}"
}

expect_equal() { # 시나리오 확인 기대 실제
  if [[ "$3" == "$4" ]]; then record PASS "$1" "$2" "$4"; else record FAIL "$1" "$2" "expected $3, got $4"; fi
}

count_matches() { # 파일 패턴(고정 문자열, 줄 시작 아님)
  local count
  count="$(grep -cF -- "$2" "$1" || true)"
  printf '%s\n' "${count:-0}"
}

# ---- 사전 점검 --------------------------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail_setup 'docker is not installed'
docker info >/dev/null 2>&1 || fail_setup 'docker daemon is not reachable'
[[ "$(docker inspect -f '{{.State.Running}}' "$pg" 2>/dev/null || true)" == true ]] ||
  fail_setup "PostgreSQL container $pg is not running (set REHEARSAL_PG_CONTAINER)"
docker exec "$pg" psql -U postgres -d postgres -X -q -Atc 'SELECT 1' >/dev/null 2>&1 ||
  fail_setup "cannot connect to $pg as postgres from inside the container"
remove_containers

echo "== 이미지 =="
if [[ "${REHEARSAL_SKIP_BUILD:-0}" == 1 ]]; then
  docker image inspect "$image" >/dev/null 2>&1 || fail_setup "image $image does not exist (unset REHEARSAL_SKIP_BUILD)"
  echo "reusing image $image"
else
  docker build -q -f "$repo_root/infra/lightsail/api.Dockerfile" -t "$image" "$repo_root" >/dev/null ||
    fail_setup 'docker image build failed (network or Docker environment)'
  built_image=1
  echo "built $image from infra/lightsail/api.Dockerfile"
fi

echo "== 데이터베이스 $db =="
docker exec "$pg" psql -U postgres -d postgres -X -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null
docker exec "$pg" psql -U postgres -d postgres -X -q -c "CREATE DATABASE $db" >/dev/null
db_created=1

# 배포와 같은 마이그레이션 명령(dist/postgres/migrate-command.js)을 이미지 안에서 실행한다.
printf '%s\n' 'DATABASE_URL=postgresql://postgres@127.0.0.1:5432/'"$db" >"$scratch/migrate.env"
docker run --rm --label "$label" --network "container:$pg" --env-file "$scratch/migrate.env" "$image" \
  node dist/postgres/migrate-command.js >/dev/null || fail_setup 'migration failed'
echo 'migrations applied'

# 가게·점주 멤버십·공개 캠페인과, 알려진 토큰의 세션 두 개(점주 STAFF, 멤버십 없는 계정). 토큰은 이 실행에서만 쓰는 무작위 값이다.
token="$(openssl rand -hex 32)"
outsider_token="$(openssl rand -hex 32)"
psql_db <<SQL
INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo, menu_items)
VALUES ('$merchant', '고래 분식', 'rehearsal', 'rehearsal', 0, 'ACTIVE', true,
  '[{"name":"라면","priceWon":4500},{"name":"김밥","priceWon":3500},{"name":"우동","priceWon":6000}]'::jsonb);
INSERT INTO merchant_members (merchant_id, account_id, role, status, revoked_at)
VALUES ('$merchant', 'rehearsal-staff', 'STAFF', 'ACTIVE', NULL);
INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
VALUES ('rehearsal-campaign', '$merchant', '도감', now() - interval '1 day', now() + interval '365 days', 'ACTIVE', true, 100);
INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
VALUES ('rehearsal-campaign', 1, '하나'), ('rehearsal-campaign', 3, '셋'), ('rehearsal-campaign', 5, '다섯');
INSERT INTO auth_sessions (id, account_id, token_hash, created_at, expires_at, last_authenticated_at)
VALUES (gen_random_uuid(), 'rehearsal-staff', decode('$(sha256_of "$token")', 'hex'), now(), now() + interval '1 day', now()),
       (gen_random_uuid(), 'rehearsal-outsider', decode('$(sha256_of "$outsider_token")', 'hex'), now(), now() + interval '1 day', now());
SQL
echo 'seeded one merchant, one STAFF membership, two sessions'

hmac_a="$(openssl rand -hex 32)"
hmac_b="$(openssl rand -hex 32)"

# ---- 시나리오 실행 ----------------------------------------------------------------------------------------
# 시나리오마다 다음 전역을 정하고 run_scenario를 부른다.
s_key=fake            # fake | empty
s_base_url=loopback   # loopback | invalid
s_api_extra=''        # API 환경 변수 줄(줄바꿈 구분)
s_fake_env=''         # 가짜 서버 환경 변수 줄
s_expect_code=''      # 실패 시나리오의 기대 실패 코드
api_log="$scratch/api.log"
fake_log="$scratch/fake.log"

wait_for_log() { # 컨테이너 패턴 초
  local tries=$(($3 * 4))
  while [[ "$tries" -gt 0 ]]; do
    if docker logs "$1" 2>&1 | grep -qF -- "$2"; then return 0; fi
    if [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || echo false)" != true ]]; then return 1; fi
    sleep 0.25
    tries=$((tries - 1))
  done
  return 1
}

run_scenario() { # 이름 구동기시나리오
  local name="$1" driver_scenario="$2" line status verdict detail rest
  echo "== $name =="
  psql_db -c 'TRUNCATE merchant_art_images, merchant_art_rounds, merchant_art, ai_art_spend'

  {
    printf '%s\n' 'FAKE_OPENAI_DELAY_MS=200'
    if [[ -n "$s_fake_env" ]]; then printf '%s\n' "$s_fake_env"; fi
  } >"$scratch/fake.env"
  docker run -d --name "$fake_name" --label "$label" --network "container:$pg" --env-file "$scratch/fake.env" \
    -v "$repo_root/scripts/fake-openai-images.mjs:/fake/fake-openai-images.mjs:ro" \
    "$image" node /fake/fake-openai-images.mjs --port "$fake_port" >/dev/null
  wait_for_log "$fake_name" 'listening on' 20 || { docker logs "$fake_name" >&2 || true; fail_setup 'fake OpenAI server did not start'; }

  {
    printf '%s=%s\n' NODE_ENV production API_BIND_HOST 0.0.0.0 PORT "$api_port" \
      DATABASE_URL "postgresql://postgres@127.0.0.1:5432/$db" \
      GOOGLE_OAUTH_CLIENT_IDS 123-rehearsal.apps.googleusercontent.com ALLOW_INSECURE_DEMO_ACCOUNT false \
      SIWE_DOMAIN rehearsal.invalid SIWE_URI https://rehearsal.invalid/wallet/verify WALLET_CHAIN_ID 84532 \
      ACCOUNT_DELETION_HMAC_SECRET "$hmac_a" MERCHANT_REFERENCE_HMAC_SECRET "$hmac_b" \
      AI_ART_STAFF_MAY_MANAGE true
    if [[ "$s_key" == fake ]]; then printf '%s=%s\n' OPENAI_API_KEY "$fake_key"; else printf '%s=\n' OPENAI_API_KEY; fi
    if [[ "$s_base_url" == loopback ]]; then
      printf '%s=%s\n' AI_ART_OPENAI_BASE_URL "http://127.0.0.1:$fake_port"
    else
      printf '%s=%s\n' AI_ART_OPENAI_BASE_URL https://example.invalid
    fi
    if [[ -n "$s_api_extra" ]]; then printf '%s\n' "$s_api_extra"; fi
  } >"$scratch/api.env"
  # 시연 compose와 같은 보안 옵션(읽기 전용 파일 시스템·/tmp만 쓰기·no-new-privileges)으로 띄운다.
  docker run -d --name "$api_name" --label "$label" --network "container:$pg" --env-file "$scratch/api.env" \
    --read-only --tmpfs /tmp --security-opt no-new-privileges:true "$image" >/dev/null
  wait_for_log "$api_name" 'wallet API listening' 40 || { docker logs "$api_name" 2>&1 | tail -20 >&2 || true; fail_setup 'API did not start'; }

  {
    printf '%s=%s\n' REHEARSAL_SCENARIO "$driver_scenario" REHEARSAL_API "http://127.0.0.1:$api_port" \
      REHEARSAL_TOKEN "$token" REHEARSAL_OUTSIDER_TOKEN "$outsider_token" REHEARSAL_MERCHANT "$merchant" \
      REHEARSAL_EXPECT_CODE "$s_expect_code"
  } >"$scratch/driver.env"
  status=0
  docker run --rm --label "$label" --network "container:$pg" --env-file "$scratch/driver.env" \
    -v "$repo_root/scripts/rehearse-ai-art-container.mjs:/app/rehearse-driver.mjs:ro" \
    "$image" node /app/rehearse-driver.mjs >"$scratch/driver.out" 2>"$scratch/driver.err" || status=$?
  while IFS='|' read -r line verdict detail rest; do
    [[ "$line" == CHECK ]] || continue
    record "$verdict" "$name" "$detail" "${rest:-}"
  done <"$scratch/driver.out"
  if [[ ! -s "$scratch/driver.out" ]]; then record FAIL "$name" 'driver produced no checks' "$(head -c 200 "$scratch/driver.err" | tr '\n' ' ')"; fi

  docker logs "$api_name" >"$api_log" 2>&1 || true
  docker logs "$fake_name" >"$fake_log" 2>&1 || true
  docker rm -f "$api_name" "$fake_name" >/dev/null 2>&1 || true

  # 모든 시나리오 공통: 가짜 키 값이 API·가짜 서버 로그에 남지 않는다.
  if grep -qF -- "$fake_key" "$api_log" "$fake_log"; then
    record FAIL "$name" 'key value must not appear in any log' 'found'
  else
    record PASS "$name" 'key value appears in no log' ''
  fi
  s_key=fake s_base_url=loopback s_api_extra='' s_fake_env='' s_expect_code=''
}

expect_startup() { expect_equal "$1" 'startup log line' "$2" "$(grep -F 'AI store art:' "$api_log" | tail -n 1)"; }
fake_requests() { count_matches "$fake_log" "fake-openai $1 "; }
spend_rows() { psql_db -Atc 'SELECT count(*) FROM ai_art_spend'; }
spend_total() { psql_db -Atc 'SELECT coalesce(sum(micro_usd), 0) FROM ai_art_spend'; }
expect_spend() { # 시나리오 행수 합계
  expect_equal "$1" 'ai_art_spend rows' "$2" "$(spend_rows)"
  expect_equal "$1" 'ai_art_spend total (µUSD)' "$3" "$(spend_total)"
}
expect_fake_counts() { # 시나리오 generations edits
  expect_equal "$1" 'fake OpenAI /v1/images/generations requests' "$2" "$(fake_requests generations)"
  expect_equal "$1" 'fake OpenAI /v1/images/edits requests' "$3" "$(fake_requests edits)"
}

# 1. 키 없음(시연 서버의 지금 상태): 꺼진 채 생성만 막힌다.
s_key=empty
run_scenario disabled disabled
expect_startup disabled 'AI store art: disabled (OPENAI_API_KEY is empty)'
expect_fake_counts disabled 0 0
expect_spend disabled 0 0

# 2. 허용되지 않은 OpenAI 주소: API는 살고 기능만 꺼진다(키가 다른 곳으로 나가지 않는다).
s_base_url=invalid
run_scenario invalid_config invalid_config
expect_startup invalid_config 'AI store art: disabled (invalid configuration)'
expect_fake_counts invalid_config 0 0

# 3. 켜진 상태의 전체 흐름.
run_scenario enabled_flow happy
expect_startup enabled_flow 'AI store art: enabled'
expect_fake_counts enabled_flow 4 1
expect_spend enabled_flow 5 $((4 * unit_draft + unit_final))

# 4. 월 예산 소진(USD 0.05).
s_api_extra='AI_ART_MONTHLY_BUDGET_USD=0.05'
run_scenario budget_exhausted budget
expect_startup budget_exhausted 'AI store art: enabled'
expect_fake_counts budget_exhausted 4 0
expect_spend budget_exhausted 4 $((4 * unit_draft))

# 5. 하루 한도(시안 2회·최종 1회).
s_api_extra=$'AI_ART_DAILY_DRAFT_ROUNDS=2\nAI_ART_DAILY_FINALS=1'
run_scenario daily_limit daily
expect_startup daily_limit 'AI store art: enabled'
expect_fake_counts daily_limit 8 1
expect_spend daily_limit 9 $((8 * unit_draft + unit_final))

# 6. OpenAI 일시 오류(429·500·503)는 한 번 재시도해 성공한다: 시안 단계와 최종 단계.
for kind in rate_limit:429 server_error:500 unavailable:503; do
  fail="${kind%%:*}"
  code="${kind##*:}"
  s_fake_env=$'FAKE_OPENAI_FAIL='"$fail"$'\nFAKE_OPENAI_FAIL_PATH=generations\nFAKE_OPENAI_FAIL_COUNT=1'
  run_scenario "retry_draft_$code" retry_draft
  expect_fake_counts "retry_draft_$code" 5 0
  expect_equal "retry_draft_$code" "fake answered $code once" 1 "$(count_matches "$fake_log" "-> $code")"
  expect_equal "retry_draft_$code" 'API client logged attempt 2' 1 "$(count_matches "$api_log" 'attempt: 2,')"
  expect_equal "retry_draft_$code" 'API client logged no attempt 3' 0 "$(count_matches "$api_log" 'attempt: 3')"
  expect_spend "retry_draft_$code" 4 $((4 * unit_draft))

  s_fake_env=$'FAKE_OPENAI_FAIL='"$fail"$'\nFAKE_OPENAI_FAIL_PATH=edits\nFAKE_OPENAI_FAIL_COUNT=1'
  run_scenario "retry_final_$code" retry_final
  expect_fake_counts "retry_final_$code" 4 2
  expect_equal "retry_final_$code" "fake answered $code once" 1 "$(count_matches "$fake_log" "-> $code")"
  expect_equal "retry_final_$code" 'API client logged attempt 2' 1 "$(count_matches "$api_log" 'attempt: 2,')"
  expect_spend "retry_final_$code" 5 $((4 * unit_draft + unit_final))
done

# 7. 오류가 계속되면 정확히 한 번만 다시 시도하고(시안 네 장 x 2회) 실패로 끝난다. 실패한 호출은 비용 0으로 남는다.
for kind in rate_limit:429 server_error:500 unavailable:503; do
  fail="${kind%%:*}"
  code="${kind##*:}"
  s_fake_env=$'FAKE_OPENAI_FAIL='"$fail"$'\nFAKE_OPENAI_FAIL_PATH=generations'
  s_expect_code=AI_ART_UPSTREAM_UNAVAILABLE
  run_scenario "fail_draft_$code" fail_draft_always
  expect_fake_counts "fail_draft_$code" 8 0
  expect_equal "fail_draft_$code" 'API client logged no attempt 3' 0 "$(count_matches "$api_log" 'attempt: 3')"
  expect_spend "fail_draft_$code" 4 0
done

# 8. 400(정책 차단)과 잔액 소진 429는 재시도하지 않는다.
s_fake_env=$'FAKE_OPENAI_FAIL=moderation\nFAKE_OPENAI_FAIL_PATH=generations'
s_expect_code=AI_ART_MODERATION_BLOCKED
run_scenario fail_draft_400 fail_draft_always
expect_fake_counts fail_draft_400 4 0
expect_equal fail_draft_400 'API client logged no attempt 2' 0 "$(count_matches "$api_log" 'attempt: 2')"
expect_spend fail_draft_400 4 0

s_fake_env=$'FAKE_OPENAI_FAIL=spend_limit\nFAKE_OPENAI_FAIL_PATH=generations'
s_expect_code=AI_ART_UPSTREAM_UNAVAILABLE
run_scenario fail_draft_429_quota fail_draft_always
expect_fake_counts fail_draft_429_quota 4 0
expect_equal fail_draft_429_quota 'API client logged no attempt 2' 0 "$(count_matches "$api_log" 'attempt: 2')"
expect_spend fail_draft_429_quota 4 0

# 9. 최종 단계에서 오류가 계속된다: 재시도 한 번 뒤 실패, 시안은 남고 최종 호출 비용은 0.
for kind in rate_limit:429 server_error:500 unavailable:503; do
  fail="${kind%%:*}"
  code="${kind##*:}"
  s_fake_env=$'FAKE_OPENAI_FAIL='"$fail"$'\nFAKE_OPENAI_FAIL_PATH=edits'
  s_expect_code=AI_ART_UPSTREAM_UNAVAILABLE
  run_scenario "fail_final_$code" fail_final_always
  expect_fake_counts "fail_final_$code" 4 2
  expect_spend "fail_final_$code" 5 $((4 * unit_draft))
done

# 10. 끝난 뒤 리허설 DB 상태를 다시 확인한다(시나리오가 남긴 것은 다음 시나리오 앞에서 지워지므로 마지막 시나리오 기준).
echo
pass_count="$(grep -c '^PASS' "$results" || true)"
fail_count="$(grep -c '^FAIL' "$results" || true)"
echo "== 결과: PASS ${pass_count:-0} / FAIL ${fail_count:-0} =="
if [[ -n "${REHEARSAL_RESULT_FILE:-}" ]]; then cp "$results" "$REHEARSAL_RESULT_FILE"; fi
if [[ "${fail_count:-0}" != 0 ]]; then
  echo 'rehearsal FAILED' >&2
  exit 1
fi
echo 'rehearsal PASSED (fake OpenAI only; no real key, no real call, nothing deployed)'
