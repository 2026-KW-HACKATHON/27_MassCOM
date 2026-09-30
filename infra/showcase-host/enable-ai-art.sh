#!/usr/bin/env bash
# 첫 명령이어야 한다: `bash -x`나 SHELLOPTS=xtrace로 불려도 이후 명령(키를 다루는 변수 치환 포함)이 추적 출력에 찍히지 않게 한다.
set +x
# 시연 서버에서 사장님 AI 가게 그림(D-048)을 켜고 끄고 살펴보는 스크립트(Issue #256).
#
#   sudo bash enable-ai-art.sh enable                # runtime.env에 SHOWCASE_OPENAI_API_KEY가 있을 때 showcase-api만 다시 만든다
#   sudo bash enable-ai-art.sh disable               # 소유자가 키 줄을 지운 뒤 showcase-api만 다시 만든다
#   sudo bash enable-ai-art.sh disable --force-drift # 비용을 멈추는 비상용: 키 말고 다른 설정이 어긋나 있어도(경고 후) 끈다
#   sudo bash enable-ai-art.sh status                # 읽기 전용
#   sudo bash enable-ai-art.sh check                 # 읽기 전용: 렌더된 설정과 설정 어긋남(drift: OK|MISMATCH)만 검사한다(키를 넣기 전에 서버를 확인할 때)
#
# 키는 만들지도 저장하지도 출력하지도 않는다. 이 스크립트는 runtime.env를 절대 고치지 않는다(키 줄은 소유자가 직접 넣고 지운다).
# 바꾸기 전 검사가 하나라도 실패하면 아무것도 바꾸지 않고 끝낸다:
#   - runtime.env가 읽을 수 있는 일반 파일이고 권한이 600이며 키 줄이 정확히 한 줄의 `NAME=값` 꼴인지(compose는 `export`·들여쓰기·`:`·`=` 앞뒤 공백·
#     나중 중복 줄·`$` 치환도 받아들이므로 이 스크립트가 다르게 읽지 못하게 그런 줄은 모두 거절한다)
#   - 실행 중 showcase-api가 하나이고 그 컨테이너의 라벨에서 읽은 릴리스 폴더의 compose 파일이 실제 경로 그대로인지
#   - compose가 렌더한 설정(메모리에서만 읽고 출력하지 않는다)의 OPENAI_API_KEY가 enable은 파일의 값과 같고 disable은 빈 값인지, 한도 값이 API 범위 안인지
#   - 실행 중 컨테이너의 config-hash가 "키와 가게 그림 설정만 실행 중인 값으로 고정한" 현재 compose 설정의 해시와 같은지(다르면 키 말고 다른
#     설정이 어긋난 것이므로 전체 시연 배포를 먼저 하라고 거절한다)
#
# 환경 변수(시험용): MASSCOM_SHOWCASE_ROOT(기본 /opt/masscom-showcase)
set -euo pipefail
umask 077
# 바이트 단위로 읽는다: 비ASCII 키·NUL 바이트가 문자 클래스나 길이 계산을 속이지 못하게 한다.
export LC_ALL=C

key_name=SHOWCASE_OPENAI_API_KEY
project=masscom-showcase
service=showcase-api
image_repository=masscom-showcase-api
startup_prefix='AI store art:'
enabled_line='AI store art: enabled'
disabled_line='AI store art: disabled (OPENAI_API_KEY is empty)'
invalid_line='AI store art: disabled (invalid configuration)'
key_charset='^[A-Za-z0-9._:~+/=-]+$'
key_max_length=512

fail() {
  echo "ai-art refused: $1" >&2
  exit 1
}

usage() {
  echo "usage: $0 enable | disable [--force-drift] | status | check" >&2
  exit 2
}

[[ $# -ge 1 && $# -le 2 ]] || usage
mode="$1"
case "$mode" in
  enable | disable | status | check) ;;
  *) usage ;;
esac
force_drift=0
if [[ $# -eq 2 ]]; then
  [[ "$mode" == disable && "$2" == --force-drift ]] || usage
  force_drift=1
fi

root="${MASSCOM_SHOWCASE_ROOT:-/opt/masscom-showcase}"
runtime_env="$root/runtime.env"
releases_prefix="$root/releases/"
compose_suffix=/infra/showcase-host/compose.yml
key_length=0
key_state=absent
key_value=

# compose는 셸 환경 변수를 --env-file보다 우선한다(sudo -E 등으로 물려받은 SHOWCASE_OPENAI_API_KEY가 파일을 덮을 수 있다).
# 그래서 compose를 부르기 전에 compose 설정에 영향을 주는 변수를 모두 지운다. 이 스크립트가 필요한 값은 뒤에서 다시 정한다.
# DOCKER_HOST·DOCKER_CONTEXT 등도 지운다: 물려받은 값이 다른 서버의 Docker로 이 스크립트를 돌리지 못하게 한다(아래 check_docker_endpoint가 다시 확인한다).
scrub_environment() {
  local name
  for name in $(compgen -v); do
    case "$name" in
      SHOWCASE_* | COMPOSE_* | MASSCOM_SHOWCASE_* | OPENAI_API_KEY | AI_ART_* | DOCKER_HOST | DOCKER_CONTEXT | DOCKER_TLS_VERIFY | DOCKER_CERT_PATH) unset "$name" ;;
    esac
  done
}
scrub_environment

file_mode() {
  local value
  # GNU stat은 -c, BSD/macOS stat은 -f. 서버(Linux)와 개발 기기(macOS) 모두에서 같은 값을 얻는다.
  if value="$(stat -c '%a' "$1" 2>/dev/null)"; then
    printf '%s\n' "$value"
  else
    stat -f '%Lp' "$1"
  fi
}

resolve_path() {
  realpath -e -- "$1" 2>/dev/null || readlink -f -- "$1" 2>/dev/null ||
    { cd -- "$(dirname -- "$1")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename -- "$1")"; }
}

# runtime.env 검사: 심볼릭 링크가 아닌 읽을 수 있는 일반 파일이고 권한이 정확히 600이며 NUL 바이트가 없어야 한다.
# 폴더·파일의 있음과 읽기 가능을 따로 확인해 "없다"와 "권한이 없다(sudo로 실행)"를 구별해 알려 준다.
check_runtime_env() {
  [[ -d "$root" ]] || fail "showcase root not found: $root"
  [[ -r "$root" && -x "$root" ]] || fail "cannot read the showcase root $root (run with sudo)"
  [[ -e "$runtime_env" || -L "$runtime_env" ]] || fail "runtime.env not found: $runtime_env"
  [[ ! -L "$runtime_env" ]] || fail "runtime.env must not be a symbolic link: $runtime_env"
  [[ -f "$runtime_env" ]] || fail "runtime.env must be a regular file: $runtime_env"
  [[ "$(file_mode "$runtime_env")" == 600 ]] || fail 'runtime.env must have mode 600'
  [[ -r "$runtime_env" ]] || fail 'runtime.env is not readable by this user (run with sudo)'
  # NUL 바이트는 bash 변수에 담기지 않아 줄이 조용히 달라진다. 있으면 거절한다. 바이트 수를 세므로 파이프가 일찍 닫히지 않는다.
  if (( $(tr -d '\000' <"$runtime_env" | wc -c) == $(wc -c <"$runtime_env") )); then
    :
  else
    fail 'runtime.env contains NUL bytes'
  fi
}

# 활성 Docker가 이 서버의 로컬 소켓인지 확인하고 컨텍스트 이름을 알려 준다(물려받은 DOCKER_HOST·컨텍스트로 다른 서버를 바꾸지 않게).
check_docker_endpoint() {
  local info name host
  info="$(docker context inspect --format '{{.Name}}|{{.Endpoints.docker.Host}}' 2>/dev/null)" ||
    fail 'cannot determine the active Docker context (is Docker installed and is this run with sudo?)'
  name="${info%%|*}"
  host="${info#*|}"
  [[ "$host" == unix://* ]] || fail "the active Docker context '$name' is not a local socket ($host); refusing to touch another machine"
  echo "docker context: $name ($host)"
}

# 키 줄을 읽되 값은 출력하지 않는다.
# key_state = absent | empty | present | malformed | noncanonical | duplicate | unsafe, key_length = 글자 수.
read_key_state() {
  local loose canonical line value
  key_state=absent
  key_length=0
  key_value=
  loose="$(grep -aEc "^[[:space:]]*(export[[:space:]]+)?${key_name}[[:space:]]*([=:]|\$)" "$runtime_env" || true)"
  canonical="$(grep -ac "^${key_name}=" "$runtime_env" || true)"
  # `export KEY=`·들여쓴 줄·`KEY: v`·`KEY = v`처럼 compose는 받아들이지만 `^KEY=`로는 안 잡히는 줄이 하나라도 있으면 거절한다.
  if [[ "$loose" != "$canonical" ]]; then
    key_state=noncanonical
    return 0
  fi
  if [[ "$canonical" -gt 1 ]]; then
    key_state=duplicate
    return 0
  fi
  [[ "$canonical" -eq 1 ]] || return 0
  line="$(grep -a "^${key_name}=" "$runtime_env")"
  value="${line#"${key_name}="}"
  # compose는 값 안의 `$`를 다른 변수로 치환한다. 치환이 있으면 파일에 적힌 값과 컨테이너가 받는 값이 달라지므로 거절한다.
  if [[ "$value" == *'$'* ]]; then
    key_state=unsafe
    return 0
  fi
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
  key_length="${#value}"
  # API가 받는 형식(공백 없는 출력 가능한 ASCII 1~512자)의 부분집합: 따옴표·역슬래시·`$`·`#`·공백 등 compose가 다르게 읽을 수 있는 글자를 뺀다.
  if [[ "$value" =~ $key_charset && "$key_length" -le "$key_max_length" ]]; then
    key_state=present
    key_value="$value"
  else
    key_state=malformed
  fi
}

describe_key() {
  case "$key_state" in
    present) echo "$key_name: present ($key_length chars, value not shown)" ;;
    empty) echo "$key_name: empty" ;;
    absent) echo "$key_name: absent" ;;
    malformed) echo "$key_name: malformed (allowed: A-Z a-z 0-9 . _ : ~ + / = - only, at most 512 chars; value not shown)" ;;
    noncanonical) echo "$key_name: non-canonical line (use exactly one line of the form $key_name=<value>: no export, indentation, spaces around = or a colon)" ;;
    duplicate) echo "$key_name: more than one line (keep exactly one)" ;;
    unsafe) echo "$key_name: value contains \$ (interpolation is not allowed; value not shown)" ;;
  esac
}

# 출력에 키 값이 섞여 나오면 가린다(순수 bash 치환이라 키가 다른 프로세스의 인자로 나가지 않는다). 실행 중 컨테이너의 키도 같이 가린다.
redact() {
  local text="$1"
  if [[ -n "$key_value" ]]; then
    text="${text//"$key_value"/[redacted]}"
  fi
  if [[ -n "${c_key:-}" ]]; then
    text="${text//"$c_key"/[redacted]}"
  fi
  printf '%s\n' "$text"
}

# 실행 중인 showcase-api 컨테이너 ID 한 개. 없거나 둘 이상이면 실패한다. `docker ps -a`로 멈춘 컨테이너(재생성이 실패한 뒤의
# created·exited 등)도 보고 그 사실을 알려 준다.
find_container() {
  local listing rest line id state running=0 total=0 states= running_id=
  listing="$(docker ps -a --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$service" --format '{{.ID}}|{{.State}}')" ||
    fail 'cannot list containers (is Docker running and is this run with sudo?)'
  rest="$listing"
  while [[ -n "$rest" ]]; do
    if [[ "$rest" == *$'\n'* ]]; then
      line="${rest%%$'\n'*}"
      rest="${rest#*$'\n'}"
    else
      line="$rest"
      rest=
    fi
    [[ -n "$line" ]] || continue
    id="${line%%|*}"
    state="${line#*|}"
    total=$((total + 1))
    states="$states ${id:0:12}=$state"
    if [[ "$state" == running ]]; then
      running=$((running + 1))
      running_id="$id"
    fi
  done
  if [[ "$running" != 1 ]]; then
    fail "expected exactly one running $service container in project $project, found $running running of $total in total (${states# }); after a failed recreate a created or exited container is left behind: check docker ps -a and docker logs <id>, fix runtime.env and run enable again, or use the manual fallback in infra/showcase-host/README.md"
  fi
  printf '%s\n' "$running_id"
}

container_id=
image_tag=
release_dir=
release_name=
compose_file=
health=
config_hash=

# 실행 중인 컨테이너의 이미지·라벨에서 이미지 태그와 릴리스 폴더를 읽는다(추측하지 않는다).
inspect_container() {
  local id="$1" info image config_files resolved
  info="$(docker inspect --format '{{.Config.Image}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{index .Config.Labels "com.docker.compose.config-hash"}}' "$id")" ||
    fail 'cannot inspect the running container'
  image="${info%%|*}"
  info="${info#*|}"
  config_files="${info%%|*}"
  info="${info#*|}"
  health="${info%%|*}"
  config_hash="${info#*|}"
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
  # 심볼릭 링크를 거친 경로는 다른 파일을 가리킬 수 있다: 실제 경로가 라벨의 경로와 같아야 한다.
  resolved="$(resolve_path "$config_files")" || fail 'cannot resolve the release compose file path'
  [[ "$resolved" == "$config_files" ]] || fail 'the release compose file path goes through a symbolic link; refusing'
  compose_file="$config_files"
  release_dir="$releases_prefix$release_name"
  container_id="$id"
}

# 프로젝트 이름을 항상 고정한다(COMPOSE_PROJECT_NAME 등이 다른 프로젝트로 돌리지 못하게).
compose() {
  docker compose -p "$project" --env-file "$runtime_env" -f "$compose_file" "$@"
}

# ---- 실행 중 컨테이너의 환경: 필요한 이름만 docker inspect 템플릿 안에서 걸러 내 다른 비밀이 이 스크립트에 들어오지 않게 한다 -----------------
c_budget=
c_drafts=
c_finals=
c_draft_model=
c_final_model=
c_staff=
c_key=

read_container_ai_env() {
  local env_text line name value
  c_budget= c_drafts= c_finals= c_draft_model= c_final_model= c_staff=
  env_text="$(docker inspect --format '{{range .Config.Env}}{{$n := index (split . "=") 0}}{{if or (eq $n "AI_ART_MONTHLY_BUDGET_USD") (eq $n "AI_ART_DAILY_DRAFT_ROUNDS") (eq $n "AI_ART_DAILY_FINALS") (eq $n "AI_ART_DRAFT_MODEL") (eq $n "AI_ART_FINAL_MODEL") (eq $n "AI_ART_STAFF_MAY_MANAGE")}}{{println .}}{{end}}{{end}}' "$1")" ||
    fail 'cannot read the container settings'
  while IFS= read -r line; do
    name="${line%%=*}"
    value="${line#*=}"
    case "$name" in
      AI_ART_MONTHLY_BUDGET_USD) c_budget="$value" ;;
      AI_ART_DAILY_DRAFT_ROUNDS) c_drafts="$value" ;;
      AI_ART_DAILY_FINALS) c_finals="$value" ;;
      AI_ART_DRAFT_MODEL) c_draft_model="$value" ;;
      AI_ART_FINAL_MODEL) c_final_model="$value" ;;
      AI_ART_STAFF_MAY_MANAGE) c_staff="$value" ;;
    esac
  done <<<"$env_text"
}

# 컨테이너의 OPENAI_API_KEY 한 개만 메모리로 읽는다(출력하지 않는다). 키가 든 문자열을 파일·here-string에 두지 않고 줄 단위로 자른다.
read_container_key() {
  local rest line
  c_key=
  rest="$(docker inspect --format '{{range .Config.Env}}{{if eq (index (split . "=") 0) "OPENAI_API_KEY"}}{{println .}}{{end}}{{end}}' "$1")" ||
    fail 'cannot read the container settings'
  while [[ -n "$rest" ]]; do
    if [[ "$rest" == *$'\n'* ]]; then
      line="${rest%%$'\n'*}"
      rest="${rest#*$'\n'}"
    else
      line="$rest"
      rest=
    fi
    case "$line" in
      OPENAI_API_KEY=*) c_key="${line#OPENAI_API_KEY=}" ;;
    esac
  done
}

show_limit() {
  local label="$1" value="$2" fallback="$3" pattern="$4"
  if [[ -z "$value" ]]; then
    redact "$label: $fallback (default)"
  elif [[ "$value" =~ $pattern ]]; then
    redact "$label: $value"
  else
    echo "$label: (unrecognized value)"
  fi
}

print_limits() {
  echo 'effective limits (container environment, no secrets):'
  show_limit '  monthly budget (USD, Korean month, showcase DB total)' "$c_budget" 5 '^[0-9]{1,6}(\.[0-9]{1,6})?$'
  show_limit '  daily draft rounds per store' "$c_drafts" 3 '^[0-9]{1,9}$'
  show_limit '  daily finals per store' "$c_finals" 3 '^[0-9]{1,9}$'
  show_limit '  draft model' "$c_draft_model" gpt-image-2.5-flare '^[A-Za-z0-9._:-]{1,80}$'
  show_limit '  final model' "$c_final_model" gpt-image-2.5-sunburst '^[A-Za-z0-9._:-]{1,80}$'
  show_limit '  staff may manage art' "$c_staff" false '^(true|false)$'
}

# ---- compose가 렌더한 설정(JSON)을 메모리에서만 읽는다 ---------------------------------------------------------------------------
rendered_json=
render_count=0
render_value=

# 렌더된 JSON에서 `"NAME": "값"` 줄을 찾아 render_count(줄 수)와 render_value(따옴표 안의 값)를 정한다. 파일·here-string 없이 문자열만 쓴다.
render_lookup() {
  local name="$1" rest="$rendered_json" line re
  render_count=0
  render_value=
  re="^[[:space:]]*\"${name}\":[[:space:]]*(.*)\$"
  while [[ -n "$rest" ]]; do
    if [[ "$rest" == *$'\n'* ]]; then
      line="${rest%%$'\n'*}"
      rest="${rest#*$'\n'}"
    else
      line="$rest"
      rest=
    fi
    if [[ "$line" =~ $re ]]; then
      render_count=$((render_count + 1))
      render_value="${BASH_REMATCH[1]}"
    fi
  done
  render_value="${render_value%,}"
  if [[ "$render_count" -eq 1 && "$render_value" == \"*\" && "${#render_value}" -ge 2 ]]; then
    render_value="${render_value#\"}"
    render_value="${render_value%\"}"
  elif [[ "$render_count" -eq 1 ]]; then
    render_count=-1
  fi
}

rendered_string() {
  render_lookup "$1"
  [[ "$render_count" -eq 1 ]] || fail "the rendered compose config has no single string value for $1; nothing was changed"
}

# API(apps/api/src/ai-art-rules.ts)와 같은 범위: 예산 0~1000(소수 여섯 자리), 하루 횟수 0~50, 모델 이름 `[A-Za-z0-9._:-]{1,80}`. 빈 값은 기본값.
check_limit_value() { # 이름 값 종류
  local name="$1" value="$2" kind="$3" whole frac
  [[ -n "$value" ]] || return 0
  case "$kind" in
    budget)
      [[ "$value" =~ ^[0-9]{1,6}(\.[0-9]{1,6})?$ ]] || fail "$name is not a decimal number with at most six decimals; nothing was changed"
      whole="${value%%.*}"
      frac=
      if [[ "$value" == *.* ]]; then frac="${value#*.}"; fi
      if (( 10#$whole > 1000 )) || { (( 10#$whole == 1000 )) && [[ -n "${frac//0/}" ]]; }; then
        fail "$name is above 1000; nothing was changed"
      fi
      ;;
    count)
      [[ "$value" =~ ^[0-9]{1,9}$ ]] || fail "$name is not a whole number; nothing was changed"
      (( 10#$value <= 50 )) || fail "$name is above 50; nothing was changed"
      ;;
    model)
      [[ "$value" =~ ^[A-Za-z0-9._:-]{1,80}$ ]] || fail "$name is not a valid model name; nothing was changed"
      ;;
  esac
}

# 렌더된 설정 검사: 키가 기대한 값인지, 한도 값이 API 범위 안인지, 다른 값에 키가 섞여 들어가지 않았는지.
check_rendered_config() {
  local name kind
  rendered_json="$(compose config --format json 2>/dev/null)" ||
    fail 'compose config --format json failed (Docker Compose v2 is required); nothing was changed'
  rendered_string OPENAI_API_KEY
  if [[ "$key_state" == present ]]; then
    [[ "$render_value" == "$key_value" ]] ||
      fail "compose would pass a different OPENAI_API_KEY than the runtime.env line (shell variable, interpolation or another file?); nothing was changed"
  else
    [[ -z "$render_value" ]] ||
      fail 'compose would still pass a non-empty OPENAI_API_KEY although the runtime.env line is empty or absent; nothing was changed'
  fi
  for name in AI_ART_MONTHLY_BUDGET_USD AI_ART_DAILY_DRAFT_ROUNDS AI_ART_DAILY_FINALS AI_ART_DRAFT_MODEL AI_ART_FINAL_MODEL; do
    rendered_string "$name"
    case "$name" in
      AI_ART_MONTHLY_BUDGET_USD) kind=budget ;;
      AI_ART_DAILY_*) kind=count ;;
      *) kind=model ;;
    esac
    check_limit_value "$name" "$render_value" "$kind"
    if [[ -n "$key_value" && "$render_value" == *"$key_value"* ]]; then
      fail "$name contains the key; nothing was changed"
    fi
  done
}

# 실행 중 컨테이너의 config-hash와, 키와 가게 그림 설정만 실행 중인 값으로 고정한 현재 compose 설정의 해시를 비교한다.
# 같으면 지금 compose 설정과 runtime.env는 (키·가게 그림 설정을 뺀) 컨테이너를 만들 때와 같다: 다시 만들어도 바뀌는 것은 그 값들뿐이다.
# drift_status = ok | mismatch | nolabel(컨테이너에 라벨이 없음) | error(해시를 계산하지 못함). 해시 값은 비밀이 아니다.
drift_status=
drift_computed=
compose_version=

compute_drift() {
  local computed
  drift_computed=
  if computed="$(
    export SHOWCASE_OPENAI_API_KEY="$c_key"
    export SHOWCASE_AI_ART_MONTHLY_BUDGET_USD="$c_budget"
    export SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS="$c_drafts"
    export SHOWCASE_AI_ART_DAILY_FINALS="$c_finals"
    export SHOWCASE_AI_ART_DRAFT_MODEL="$c_draft_model"
    export SHOWCASE_AI_ART_FINAL_MODEL="$c_final_model"
    compose config --hash "$service" 2>/dev/null
  )"; then
    drift_computed="${computed##* }"
    if [[ -z "$config_hash" ]]; then
      drift_status=nolabel
    elif [[ "$drift_computed" == "$config_hash" ]]; then
      drift_status=ok
    else
      drift_status=mismatch
    fi
  else
    drift_status=error
  fi
}

drift_detail() {
  printf 'running label %s, computed %s, docker compose %s' "${config_hash:-none}" "${drift_computed:-none}" "${compose_version:-unknown}"
}

check_config_drift() {
  compute_drift
  case "$drift_status" in
    ok) ;;
    error) fail 'compose config --hash failed; nothing was changed' ;;
    nolabel) fail "the running container has no compose config-hash label ($(drift_detail)); do a full showcase deploy first (only to stop the cost: disable --force-drift); nothing was changed" ;;
    *) fail "the running container differs from the current release compose file or runtime.env in more than the key and the AI art settings (config drift: $(drift_detail)); do a full showcase deploy first (only to stop the cost: disable --force-drift); nothing was changed" ;;
  esac
}

# disable --force-drift: 비용을 멈추는 스위치라 설정 어긋남이 있어도 진행한다. 키 줄이 비어 있어야 한다는 조건과 다른 모든 검사는 그대로다.
allow_drift() {
  compute_drift
  case "$drift_status" in
    ok) echo 'drift: OK (--force-drift was not needed)' ;;
    error) fail 'compose config --hash failed; nothing was changed' ;;
    *) echo "warning: --force-drift ignores the config drift ($(drift_detail)); this recreate applies every difference between runtime.env or the compose file and the running container, not only the key" ;;
  esac
}

# 컨테이너 로그에서 마지막 `AI store art:` 기동 줄 하나만 꺼낸다. 알려진 세 줄과 줄 전체가 같은 것만 인정한다(다른 로그는 출력하지 않는다).
# awk 한 프로세스가 입력을 끝까지 읽으므로 파이프가 일찍 닫히지 않는다(pipefail에서 SIGPIPE로 실패하지 않는다).
startup_line() {
  docker logs "$1" 2>&1 | awk -v a="$enabled_line" -v b="$disabled_line" -v c="$invalid_line" \
    '$0 == a || $0 == b || $0 == c { last = $0 } END { if (last != "") print last }' || true
}

do_status() {
  local line verdict key_report
  check_runtime_env
  read_key_state
  echo "runtime.env: mode 600"
  describe_key
  check_docker_endpoint
  container_id="$(find_container)"
  inspect_container "$container_id"
  read_container_ai_env "$container_id"
  read_container_key "$container_id"
  echo "showcase-api container: ${container_id:0:12} (health: $health)"
  echo "image tag: $image_tag"
  echo "release dir: $release_dir"
  line="$(startup_line "$container_id")"
  redact "startup log: ${line:-(no known '$startup_prefix' line found)}"
  if [[ -z "$c_key" ]]; then
    key_report='empty'
  elif [[ "$key_state" == present && "$c_key" == "$key_value" ]]; then
    key_report='set (same as the runtime.env line)'
  else
    key_report='set (different from the runtime.env line)'
  fi
  echo "running container OPENAI_API_KEY: $key_report"
  print_limits
  if [[ "$key_state" == present && "$c_key" == "$key_value" && "$line" == "$enabled_line" ]]; then
    verdict='ENABLED'
  elif [[ ( "$key_state" == absent || "$key_state" == empty ) && -z "$c_key" && "$line" == "$disabled_line" ]]; then
    verdict='DISABLED'
  else
    verdict='NEEDS_RECREATE_OR_CHECK (runtime.env and the running container disagree, the key line is not usable, or the config is invalid)'
  fi
  echo "state: $verdict"
}

do_change() {
  local old_id new_id up_output line expected file_tag
  check_runtime_env
  read_key_state
  echo 'runtime.env: mode 600'
  describe_key
  if [[ "$mode" == enable ]]; then
    [[ "$key_state" == present ]] || fail "enable needs exactly one non-empty valid $key_name line in runtime.env (the owner adds it; this script never edits runtime.env)"
    expected="$enabled_line"
  else
    [[ "$key_state" == absent || "$key_state" == empty ]] ||
      fail "disable needs the $key_name line removed or emptied in runtime.env first (this script never edits runtime.env)"
    expected="$disabled_line"
  fi

  check_docker_endpoint
  old_id="$(find_container)"
  inspect_container "$old_id"
  echo "showcase-api container: ${old_id:0:12}"
  echo "image tag: $image_tag"
  echo "release dir: $release_dir"

  # 이미지는 지금 실행 중인 태그로 고정해 키 한 줄 때문에 이미지가 바뀌지 않게 한다(셸 환경이 --env-file보다 우선한다).
  file_tag="$(awk '/^MASSCOM_SHOWCASE_IMAGE_TAG=/ { v = $0 } END { print v }' "$runtime_env" || true)"
  file_tag="${file_tag#MASSCOM_SHOWCASE_IMAGE_TAG=}"
  if [[ "$file_tag" != "$image_tag" ]]; then
    echo "note: runtime.env image tag (${file_tag:-unset}) differs from the running tag; keeping the running tag $image_tag"
  fi
  export MASSCOM_SHOWCASE_IMAGE_TAG="$image_tag"

  compose_version="$(docker compose version --short 2>/dev/null)" || fail 'docker compose is not available'
  # 렌더만 해 보고 출력은 버린다. 빈 필수 값이나 잘못된 보간이면 여기서 멈춘다(아직 아무것도 바꾸지 않았다).
  if ! compose config --quiet >/dev/null 2>&1; then
    fail 'compose config does not render with runtime.env; nothing was changed'
  fi
  check_rendered_config
  read_container_ai_env "$old_id"
  read_container_key "$old_id"
  if [[ "$force_drift" == 1 ]]; then
    allow_drift
  else
    check_config_drift
  fi

  echo "recreating $service only ($mode)..."
  if ! up_output="$(compose up -d --no-deps --no-build --pull never \
    --force-recreate --wait --wait-timeout 180 "$service" 2>&1)"; then
    redact "$up_output" >&2
    fail "compose up failed; the old container may be gone or a new one left in the created state: check docker ps -a and docker logs <id>. To go back, restore the previous runtime.env key line and run this script again, or use the manual fallback in infra/showcase-host/README.md; $0 status shows the current state"
  fi

  new_id="$(find_container)"
  [[ "$new_id" != "$old_id" ]] || fail 'the container was not recreated; check the compose output'
  inspect_container "$new_id"
  [[ "$health" == healthy ]] || fail "the recreated container is not healthy (health: $health)"
  read_container_key "$new_id"
  if [[ "$mode" == enable && "$c_key" != "$key_value" ]]; then
    fail 'the recreated container does not carry the runtime.env key; check with status (nothing else was changed)'
  fi
  if [[ "$mode" == disable && -n "$c_key" ]]; then
    fail 'the recreated container still carries a key; check with status'
  fi
  line="$(startup_line "$new_id")"
  if [[ "$line" != "$expected" ]]; then
    redact "startup log: ${line:-(no known '$startup_prefix' line found)}" >&2
    if [[ "$mode" == enable ]]; then
      fail "startup log is not '$enabled_line'; the container was recreated with the key, fix runtime.env (key format and SHOWCASE_AI_ART_* values) and run enable again, or empty the key line and run disable"
    fi
    fail "startup log is not '$disabled_line'; the key line may still be set or the config is invalid"
  fi
  echo "showcase-api recreated: ${new_id:0:12} (health: $health)"
  redact "startup log: $line"
  read_container_ai_env "$new_id"
  print_limits
  if [[ "$mode" == enable ]]; then
    echo 'AI store art is ENABLED. Real calls now cost money: check ai_art_spend after the first call.'
  else
    echo 'AI store art is DISABLED.'
  fi
}

# 읽기 전용: compose가 렌더한 설정과 설정 어긋남만 검사하고 drift: OK|MISMATCH로 알려 준다. 키를 넣기 전에 이 서버에서 enable이 통과할지 확인할 때 쓴다.
do_check() {
  local bad=0 problem
  check_runtime_env
  read_key_state
  echo 'runtime.env: mode 600'
  describe_key
  case "$key_state" in
    present | absent | empty) ;;
    *) bad=1 ;;
  esac
  check_docker_endpoint
  container_id="$(find_container)"
  inspect_container "$container_id"
  echo "showcase-api container: ${container_id:0:12} (health: $health)"
  echo "image tag: $image_tag"
  echo "release dir: $release_dir"
  export MASSCOM_SHOWCASE_IMAGE_TAG="$image_tag"
  compose_version="$(docker compose version --short 2>/dev/null)" || fail 'docker compose is not available'
  echo "docker compose: $compose_version"
  if ! compose config --quiet >/dev/null 2>&1; then
    echo 'rendered config: MISMATCH (compose config does not render with runtime.env)'
    bad=1
  elif problem="$(check_rendered_config 2>&1)"; then
    echo 'rendered config: OK'
  else
    echo "rendered config: MISMATCH (${problem#ai-art refused: })"
    bad=1
  fi
  read_container_ai_env "$container_id"
  read_container_key "$container_id"
  compute_drift
  case "$drift_status" in
    ok) echo "drift: OK (config-hash ${config_hash:0:12})" ;;
    error) echo 'drift: MISMATCH (compose config --hash failed)'; bad=1 ;;
    nolabel) echo "drift: MISMATCH (the running container has no config-hash label; $(drift_detail))"; bad=1 ;;
    *) echo "drift: MISMATCH ($(drift_detail))"; bad=1 ;;
  esac
  if [[ "$bad" == 0 ]]; then
    echo 'check: OK (nothing was changed)'
  else
    echo 'check: FAILED (nothing was changed)'
    exit 1
  fi
}

case "$mode" in
  status) do_status ;;
  check) do_check ;;
  *) do_change ;;
esac
