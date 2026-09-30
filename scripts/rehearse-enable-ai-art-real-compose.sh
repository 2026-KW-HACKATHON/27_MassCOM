#!/usr/bin/env bash
# infra/showcase-host/enable-ai-art.sh를 가짜 docker가 아니라 진짜 Docker Compose(v2)와 진짜 컨테이너로 시험한다(Issue #256).
#
#   bash scripts/rehearse-enable-ai-art-real-compose.sh
#
# 시연 호스트와 같은 compose 파일(infra/showcase-host/compose.yml)로 임시 폴더에 진짜 postgres·migrate·showcase-api를 띄우고(가짜 키·가짜 값,
# OpenAI는 부르지 않는다) status·enable·disable을 실제로 돌려 config-hash 비교·렌더된 설정 검사·`--wait`·기동 로그 확인이 진짜 compose와
# 맞물리는지 본다. 스크립트가 고정해야 하는 프로젝트 이름이 `masscom-showcase`라서 그 프로젝트의 컨테이너·볼륨·`masscom_showcase_edge`
# 네트워크가 이미 있으면(진짜 시연 서버 등) 아무것도 하지 않고 멈춘다. 끝나면 컨테이너·볼륨·네트워크·이미지를 모두 지운다.
# 로컬 127.0.0.1:3301이 비어 있어야 한다. 이미지 빌드에 1분 안팎이 든다.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
project=masscom-showcase
network=masscom_showcase_edge
tag="rehearsal-$$"
image="masscom-showcase-api:$tag"
scratch="$(mktemp -d -t masscom-real-compose.XXXXXX)"
scratch="$(cd "$scratch" && pwd -P)"
root="$scratch/opt/masscom-showcase"
release="$root/releases/$tag"
runtime="$root/runtime.env"
fake_key='fake-real-compose-key-not-a-real-openai-key'
inherited_key='inherited-shell-value-must-not-reach-compose'
out="$scratch/out.log"
all_out="$scratch/all.log"
failed=0
created_network=0
started=0

block() {
  echo "real-compose rehearsal BLOCKED: $1" >&2
  exit 2
}

command -v docker >/dev/null 2>&1 || block 'docker is not installed'
docker info >/dev/null 2>&1 || block 'docker daemon is not reachable'
if [[ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ]]; then
  block "containers of the compose project $project already exist (this is meant for a machine without the showcase stack)"
fi
if docker network inspect "$network" >/dev/null 2>&1; then block "network $network already exists"; fi
if docker image inspect "$image" >/dev/null 2>&1; then block "image $image already exists"; fi

compose() { docker compose -p "$project" --env-file "$runtime" -f "$release/infra/showcase-host/compose.yml" "$@"; }

cleanup() {
  if [[ "$started" == 1 ]]; then compose down -v --remove-orphans >/dev/null 2>&1 || true; fi
  if [[ "$created_network" == 1 ]]; then docker network rm "$network" >/dev/null 2>&1 || true; fi
  docker rmi "$image" >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT

record() { # 판정 이름 상세
  printf '  %-4s %s%s\n' "$1" "$2" "${3:+ ($3)}"
  if [[ "$1" == FAIL ]]; then failed=$((failed + 1)); fi
}
set_line() { # 이름 값: runtime.env의 그 줄을 바꾸거나 더한다(파일 권한 600 유지)
  { grep -v "^$1=" "$runtime" || true; printf '%s=%s\n' "$1" "$2"; } >"$runtime.tmp"
  chmod 600 "$runtime.tmp"
  mv "$runtime.tmp" "$runtime"
}
run() { # 인자: 스크립트 모드. 출력은 $out에, 종료 코드는 반환값
  local status=0
  MASSCOM_SHOWCASE_ROOT="$root" bash "$repo_root/infra/showcase-host/enable-ai-art.sh" "$@" >"$out" 2>&1 || status=$?
  cat "$out" >>"$all_out"
  return "$status"
}
expect_ok() { # 이름 기대 문구 모드...
  local name="$1" text="$2"; shift 2
  if run "$@" && grep -qF -- "$text" "$out"; then record PASS "$name"; else record FAIL "$name" "$(tail -n 3 "$out" | tr '\n' ' ')"; fi
}
expect_refused() { # 이름 기대 문구 모드...
  local name="$1" text="$2"; shift 2
  if run "$@"; then record FAIL "$name" 'unexpectedly succeeded'
  elif grep -qF -- "$text" "$out"; then record PASS "$name"
  else record FAIL "$name" "$(tail -n 2 "$out" | tr '\n' ' ')"; fi
}

echo '== 이미지 빌드와 임시 시연 호스트 =='
docker build -q -f "$repo_root/infra/lightsail/api.Dockerfile" -t "$image" "$repo_root" >/dev/null || block 'docker image build failed'
mkdir -p "$release/infra/showcase-host"
cp "$repo_root/infra/showcase-host/compose.yml" "$release/infra/showcase-host/compose.yml"
docker network create "$network" >/dev/null
created_network=1
{
  printf '%s=%s\n' MASSCOM_SHOWCASE_IMAGE_TAG "$tag" SHOWCASE_GOOGLE_WEB_CLIENT_ID 1-rehearsal.apps.googleusercontent.com \
    SHOWCASE_INVITED_SUBJECT_SHA256 "$(printf 'a%.0s' $(seq 1 64))" SHOWCASE_STAFF_SUBJECT_SHA256 ''
  printf '%s=%s\n' SHOWCASE_HOST_POSTGRES_PASSWORD "$(openssl rand -hex 16)" \
    SHOWCASE_ACCOUNT_DELETION_HMAC_SECRET "$(openssl rand -hex 32)" SHOWCASE_MERCHANT_REFERENCE_HMAC_SECRET "$(openssl rand -hex 32)" \
    SHOWCASE_OPENAI_API_KEY ''
} >"$runtime"
chmod 600 "$runtime"
started=1
compose up -d --no-build --wait showcase-api >/dev/null 2>&1 || block 'the temporary showcase stack did not start (is 127.0.0.1:3301 free?)'
echo 'showcase-api is up with an empty key'

echo '== status·enable·disable =='
expect_ok 'status with an empty key -> DISABLED' 'state: DISABLED' status
set_line SHOWCASE_OPENAI_API_KEY "$fake_key"
expect_ok 'status with a key added but no recreate -> NEEDS_RECREATE_OR_CHECK' 'NEEDS_RECREATE_OR_CHECK' status
expect_ok 'enable -> AI store art: enabled' 'startup log: AI store art: enabled' enable
expect_ok 'status after enable -> ENABLED and the container key equals the file key' 'state: ENABLED' status
grep -qF 'set (same as the runtime.env line)' "$out" && record PASS 'status reports the container key as the file key' || record FAIL 'status key comparison'
SHOWCASE_OPENAI_API_KEY="$inherited_key" COMPOSE_PROJECT_NAME=other OPENAI_API_KEY="$inherited_key" \
  expect_ok 'enable with inherited shell variables still uses the file key' 'startup log: AI store art: enabled' enable
expect_ok 'status after the inherited-variable enable -> the file key' 'set (same as the runtime.env line)' status
set_line SHOWCASE_OPENAI_API_KEY ''
set_line SHOWCASE_INVITED_SUBJECT_SHA256 "$(printf 'b%.0s' $(seq 1 64))"
expect_refused 'disable with unrelated runtime.env drift is refused (config-hash)' 'config drift' disable
set_line SHOWCASE_INVITED_SUBJECT_SHA256 "$(printf 'a%.0s' $(seq 1 64))"
expect_ok 'disable after the drift is reverted -> disabled' 'startup log: AI store art: disabled (OPENAI_API_KEY is empty)' disable
set_line SHOWCASE_OPENAI_API_KEY "$fake_key"
printf 'SHOWCASE_AI_ART_DAILY_FINALS=2\nSHOWCASE_AI_ART_MONTHLY_BUDGET_USD=4\n' >>"$runtime"
expect_ok 'enable with changed limits shows them' 'daily finals per store: 2' enable
grep -qF 'monthly budget (USD, Korean month, showcase DB total): 4' "$out" && record PASS 'the changed budget is shown' || record FAIL 'changed budget'
set_line SHOWCASE_AI_ART_DAILY_FINALS 51
expect_refused 'enable with an out-of-range limit is refused' 'AI_ART_DAILY_FINALS is above 50' enable

if grep -qF -e "$fake_key" -e "$inherited_key" "$all_out"; then record FAIL 'no key value appears in any output' 'leak'; else record PASS 'no key value appears in any output'; fi
echo
if [[ "$failed" != 0 ]]; then echo "real-compose rehearsal FAILED ($failed)" >&2; exit 1; fi
echo 'real-compose rehearsal PASSED (fake key only, no OpenAI call, temporary stack removed)'
