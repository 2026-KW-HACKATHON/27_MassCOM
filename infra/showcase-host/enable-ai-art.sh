#!/usr/bin/env bash
# 시연 서버에서 사장님 AI 가게 그림(D-048)을 켜고 끄고 살펴보는 스크립트(Issue #256).
#
#   sudo bash enable-ai-art.sh enable   # runtime.env에 SHOWCASE_OPENAI_API_KEY가 있을 때 showcase-api만 다시 만든다
#   sudo bash enable-ai-art.sh disable  # 소유자가 키 줄을 지운 뒤 showcase-api만 다시 만든다
#   sudo bash enable-ai-art.sh status   # 읽기 전용
#
# 키는 만들지도 저장하지도 출력하지도 않는다. 이 스크립트는 runtime.env를 절대 고치지 않는다(키 줄은 소유자가 직접 넣고 지운다).
# 바꾸기 전 검사(파일 권한·키 유무·실행 중 컨테이너·compose 설정)가 하나라도 실패하면 아무것도 바꾸지 않고 끝낸다.
#
# 환경 변수(시험용): MASSCOM_SHOWCASE_ROOT(기본 /opt/masscom-showcase)
set -euo pipefail
umask 077

key_name=SHOWCASE_OPENAI_API_KEY
project=masscom-showcase
service=showcase-api
image_repository=masscom-showcase-api
startup_prefix='AI store art:'
enabled_line='AI store art: enabled'
disabled_line='AI store art: disabled (OPENAI_API_KEY is empty)'

fail() {
  echo "ai-art refused: $1" >&2
  exit 1
}

usage() {
  echo "usage: $0 enable|disable|status" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
mode="$1"
case "$mode" in
  enable | disable | status) ;;
  *) usage ;;
esac

root="${MASSCOM_SHOWCASE_ROOT:-/opt/masscom-showcase}"
runtime_env="$root/runtime.env"
releases_prefix="$root/releases/"
compose_suffix=/infra/showcase-host/compose.yml
key_length=0
key_state=absent
key_value=

file_mode() {
  local value
  # GNU stat은 -c, BSD/macOS stat은 -f. 서버(Linux)와 개발 기기(macOS) 모두에서 같은 값을 얻는다.
  if value="$(stat -c '%a' "$1" 2>/dev/null)"; then
    printf '%s\n' "$value"
  else
    stat -f '%Lp' "$1"
  fi
}

# runtime.env 검사: 심볼릭 링크가 아닌 일반 파일이고 권한이 정확히 600이어야 한다.
check_runtime_env() {
  [[ -d "$root" ]] || fail "showcase root not found: $root"
  [[ -f "$runtime_env" && ! -L "$runtime_env" ]] || fail "runtime.env must be a regular file: $runtime_env"
  [[ "$(file_mode "$runtime_env")" == 600 ]] || fail 'runtime.env must have mode 600'
}

# 키 줄을 읽되 값은 출력하지 않는다. key_state=absent|empty|present|malformed, key_length=글자 수.
read_key_state() {
  local line value
  key_state=absent
  key_length=0
  key_value=
  # compose의 env 파일은 같은 이름이 여러 번 나오면 마지막 줄을 쓴다.
  line="$(grep -E "^${key_name}=" "$runtime_env" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 0
  value="${line#"${key_name}="}"
  # 앞뒤 공백과 따옴표 한 겹은 compose가 벗겨 준다.
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  if [[ -z "$value" ]]; then
    key_state=empty
    return 0
  fi
  key_value="$value"
  key_length="${#value}"
  # API가 받는 형식: 공백 없는 출력 가능한 ASCII 1~512자.
  if [[ "$value" =~ ^[[:graph:]]+$ && "$key_length" -le 512 ]]; then
    key_state=present
  else
    key_state=malformed
  fi
}

describe_key() {
  case "$key_state" in
    present) echo "$key_name: present ($key_length chars, value not shown)" ;;
    empty) echo "$key_name: empty" ;;
    absent) echo "$key_name: absent" ;;
    malformed) echo "$key_name: malformed (must be printable ASCII without spaces, at most 512 chars; value not shown)" ;;
  esac
}

# 실행 중인 showcase-api 컨테이너 ID 한 개. 없거나 둘 이상이면 실패한다.
find_container() {
  local ids count
  ids="$(docker ps --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$service" --format '{{.ID}}')" ||
    fail 'cannot list containers (is Docker running and is this run with sudo?)'
  count="$(printf '%s\n' "$ids" | grep -c . || true)"
  [[ "$count" == 1 ]] || fail "expected exactly one running $service container in project $project, found $count"
  printf '%s\n' "$ids"
}

container_id=
image_tag=
release_dir=
release_name=
compose_file=
health=

# 실행 중인 컨테이너의 이미지·라벨에서 이미지 태그와 릴리스 폴더를 읽는다(추측하지 않는다).
inspect_container() {
  local id="$1" info image config_files
  info="$(docker inspect --format '{{.Config.Image}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")" ||
    fail 'cannot inspect the running container'
  image="${info%%|*}"
  info="${info#*|}"
  config_files="${info%%|*}"
  health="${info#*|}"
  [[ "$image" == "$image_repository":* ]] || fail "running image is not $image_repository:<tag>"
  image_tag="${image#"$image_repository":}"
  [[ "$image_tag" =~ ^[A-Za-z0-9_.-]{1,128}$ ]] || fail 'running image tag has an unexpected form'
  [[ "$config_files" != *,* ]] || fail 'container was created from several compose files; refusing'
  [[ "$config_files" == "$releases_prefix"*"$compose_suffix" ]] ||
    fail "container compose file is outside $releases_prefix<release>$compose_suffix"
  release_name="${config_files#"$releases_prefix"}"
  release_name="${release_name%"$compose_suffix"}"
  [[ "$release_name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || fail 'container release folder has an unexpected name'
  [[ -f "$config_files" && ! -L "$config_files" ]] || fail 'the release compose file no longer exists'
  compose_file="$config_files"
  release_dir="$releases_prefix$release_name"
  container_id="$id"
}

compose() {
  docker compose --env-file "$runtime_env" -f "$compose_file" "$@"
}

# 출력에 키 값이 섞여 나오면 가린다(순수 bash 치환이라 키가 다른 프로세스의 인자로 나가지 않는다).
redact() {
  local text="$1"
  if [[ -n "$key_value" ]]; then
    text="${text//"$key_value"/[redacted]}"
  fi
  printf '%s\n' "$text"
}

# 컨테이너 로그에서 마지막 `AI store art:` 기동 줄 하나만 꺼낸다(다른 로그는 출력하지 않는다).
startup_line() {
  local logs
  logs="$(docker logs "$1" 2>&1 || true)"
  printf '%s\n' "$logs" | grep -F "$startup_prefix" | tail -n 1 || true
}

# 컨테이너 환경에서 비밀이 아닌 AI_ART_* 값만 골라 유효 한도를 보여 준다. 비어 있으면 API 기본값이다.
print_limits() {
  local env_text line name value budget= drafts= finals= draft_model= final_model= staff=
  env_text="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$1")" || return 0
  while IFS= read -r line; do
    name="${line%%=*}"
    value="${line#*=}"
    case "$name" in
      AI_ART_MONTHLY_BUDGET_USD) budget="$value" ;;
      AI_ART_DAILY_DRAFT_ROUNDS) drafts="$value" ;;
      AI_ART_DAILY_FINALS) finals="$value" ;;
      AI_ART_DRAFT_MODEL) draft_model="$value" ;;
      AI_ART_FINAL_MODEL) final_model="$value" ;;
      AI_ART_STAFF_MAY_MANAGE) staff="$value" ;;
    esac
  done <<<"$env_text"
  echo 'effective limits (container environment, no secrets):'
  show_limit '  monthly budget (USD, Korean month, showcase DB total)' "$budget" 5 '^[0-9]{1,6}(\.[0-9]{1,6})?$'
  show_limit '  daily draft rounds per store' "$drafts" 3 '^[0-9]{1,9}$'
  show_limit '  daily finals per store' "$finals" 3 '^[0-9]{1,9}$'
  show_limit '  draft model' "$draft_model" gpt-image-2.5-flare '^[A-Za-z0-9._:-]{1,80}$'
  show_limit '  final model' "$final_model" gpt-image-2.5-sunburst '^[A-Za-z0-9._:-]{1,80}$'
  show_limit '  staff may manage art' "$staff" false '^(true|false)$'
}

show_limit() {
  local label="$1" value="$2" fallback="$3" pattern="$4"
  if [[ -z "$value" ]]; then
    echo "$label: $fallback (default)"
  elif [[ "$value" =~ $pattern ]]; then
    echo "$label: $value"
  else
    echo "$label: (unrecognized value)"
  fi
}

do_status() {
  local line verdict
  check_runtime_env
  read_key_state
  echo "runtime.env: mode 600"
  describe_key
  container_id="$(find_container)"
  inspect_container "$container_id"
  echo "showcase-api container: ${container_id:0:12} (health: $health)"
  echo "image tag: $image_tag"
  echo "release dir: $release_dir"
  line="$(startup_line "$container_id")"
  echo "startup log: ${line:-(no '$startup_prefix' line found)}"
  print_limits "$container_id"
  if [[ "$key_state" == present && "$line" == "$enabled_line" ]]; then
    verdict='ENABLED'
  elif [[ "$key_state" != present && "$line" == "$disabled_line" ]]; then
    verdict='DISABLED'
  else
    verdict='NEEDS_RECREATE_OR_CHECK (runtime.env and the running container disagree, or the config is invalid)'
  fi
  echo "state: $verdict"
}

do_change() {
  local old_id new_id up_output line expected
  check_runtime_env
  read_key_state
  echo 'runtime.env: mode 600'
  describe_key
  if [[ "$mode" == enable ]]; then
    [[ "$key_state" == present ]] || fail "enable needs a non-empty valid $key_name line in runtime.env (the owner adds it; this script never edits runtime.env)"
    expected="$enabled_line"
  else
    [[ "$key_state" == absent || "$key_state" == empty ]] ||
      fail "disable needs the $key_name line removed or emptied in runtime.env first (this script never edits runtime.env)"
    expected="$disabled_line"
  fi

  old_id="$(find_container)"
  inspect_container "$old_id"
  echo "showcase-api container: ${old_id:0:12}"
  echo "image tag: $image_tag"
  echo "release dir: $release_dir"

  # 이미지는 지금 실행 중인 태그로 고정해 키 한 줄 때문에 이미지가 바뀌지 않게 한다(셸 환경이 --env-file보다 우선한다).
  local file_tag
  file_tag="$(grep -E '^MASSCOM_SHOWCASE_IMAGE_TAG=' "$runtime_env" | tail -n 1 || true)"
  file_tag="${file_tag#MASSCOM_SHOWCASE_IMAGE_TAG=}"
  if [[ "$file_tag" != "$image_tag" ]]; then
    echo "note: runtime.env image tag (${file_tag:-unset}) differs from the running tag; keeping the running tag $image_tag"
  fi
  export MASSCOM_SHOWCASE_IMAGE_TAG="$image_tag"

  docker compose version >/dev/null 2>&1 || fail 'docker compose is not available'
  # 렌더만 해 보고 출력은 버린다. 빈 필수 값이나 잘못된 보간이면 여기서 멈춘다(아직 아무것도 바꾸지 않았다).
  if ! compose config --quiet >/dev/null 2>&1; then
    fail 'compose config does not render with runtime.env; nothing was changed'
  fi

  echo "recreating $service only ($mode)..."
  if ! up_output="$(compose up -d --no-deps --no-build --pull never \
    --force-recreate --wait --wait-timeout 180 "$service" 2>&1)"; then
    redact "$up_output" >&2
    fail "compose up failed; check the container with: $0 status"
  fi

  new_id="$(find_container)"
  [[ "$new_id" != "$old_id" ]] || fail 'the container was not recreated; check the compose output'
  inspect_container "$new_id"
  [[ "$health" == healthy ]] || fail "the recreated container is not healthy (health: $health)"
  line="$(startup_line "$new_id")"
  if [[ "$line" != "$expected" ]]; then
    echo "startup log: ${line:-(no '$startup_prefix' line found)}" >&2
    if [[ "$mode" == enable ]]; then
      fail "startup log is not '$enabled_line'; the container was recreated with the key, fix runtime.env (key format and SHOWCASE_AI_ART_* values) and run enable again, or empty the key line and run disable"
    fi
    fail "startup log is not '$disabled_line'; the key line may still be set or the config is invalid"
  fi
  echo "showcase-api recreated: ${new_id:0:12} (health: $health)"
  echo "startup log: $line"
  print_limits "$new_id"
  if [[ "$mode" == enable ]]; then
    echo 'AI store art is ENABLED. Real calls now cost money: check ai_art_spend after the first call.'
  else
    echo 'AI store art is DISABLED.'
  fi
}

if [[ "$mode" == status ]]; then
  do_status
else
  do_change
fi
