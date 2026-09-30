#!/usr/bin/env bash
# infra/showcase-host/enable-ai-art.sh 시험(Issue #256). PATH의 가짜 docker로 실제 Docker·OpenAI 없이 켜기·끄기·상태 흐름을 확인한다.
# 가짜 docker는 compose가 runtime.env를 읽는 방식(`export`·들여쓰기·`:`·`=` 앞뒤 공백·나중 중복 줄 우선·셸 환경 변수 우선)과
# 렌더된 JSON 설정, config-hash 라벨을 흉내 내 "스크립트가 읽은 값"과 "compose가 읽을 값"이 어긋나는 경우를 시험한다.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
script="$repo_root/infra/showcase-host/enable-ai-art.sh"
[[ -f "$script" ]] || { echo 'missing enable-ai-art.sh' >&2; exit 1; }
scratch="$(mktemp -d -t masscom-enable-ai-art.XXXXXX)"
trap 'rm -rf -- "$scratch"' EXIT
scratch="$(cd "$scratch" && pwd -P)"

root="$scratch/opt/masscom-showcase"
runtime="$root/runtime.env"
release="$root/releases/abc1234"
compose_file="$release/infra/showcase-host/compose.yml"
state="$scratch/state"
bin="$scratch/bin"
fake_key='DO_NOT_PRINT_FAKE_OPENAI_VALUE_0123456789'
other_key='DO_NOT_PRINT_ANOTHER_FAKE_VALUE_9876543210'
out="$scratch/out.log"
mkdir -p "$bin" "$release/infra/showcase-host" "$root"
printf 'services: {}\n' >"$compose_file"

# ---- 가짜 docker: 호출을 기록하고 상태 폴더의 컨테이너·compose를 흉내 낸다 ------------------------------------
cat >"$bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set +x
set -euo pipefail
state="${FAKE_STATE:?}"
printf '%s\n' "$*" >>"$state/calls.log"

# compose가 env 파일에서 읽는 값: 마지막으로 나온 줄이 이긴다. `export`·들여쓰기·`NAME: v`·`NAME = v`도 받아들이고 따옴표 한 겹을 벗긴다.
file_var() { # env-file 이름
  local line value= re
  re="^[[:space:]]*(export[[:space:]]+)?$2[[:space:]]*[=:][[:space:]]*(.*)\$"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ $re ]]; then value="${BASH_REMATCH[2]}"; fi
  done <"$1"
  value="${value%"${value##*[![:space:]]}"}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}
# 셸 환경 변수가 있으면 그것이 이긴다(compose의 우선순위).
effective() { # 이름 env-file
  local name="$1"
  if [[ -n "${!name+x}" ]]; then printf '%s' "${!name}"; else file_var "$2" "$name"; fi
}
hash_vars='MASSCOM_SHOWCASE_IMAGE_TAG SHOWCASE_OPENAI_API_KEY SHOWCASE_AI_ART_MONTHLY_BUDGET_USD SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS SHOWCASE_AI_ART_DAILY_FINALS SHOWCASE_AI_ART_DRAFT_MODEL SHOWCASE_AI_ART_FINAL_MODEL SHOWCASE_INVITED_SUBJECT_SHA256'
fake_hash() { # env-file compose-file
  local v
  { for v in $hash_vars; do printf '%s=%s\n' "$v" "$(effective "$v" "$1")"; done; shasum -a 256 "$2" | cut -d' ' -f1; } |
    shasum -a 256 | cut -d' ' -f1
}
log_env() { # 하위 명령 이름: compose가 볼 수 있는 SHOWCASE_*·COMPOSE_*·OPENAI_API_KEY·AI_ART_*(이미지 태그 제외) 변수 이름
  local seen= name
  for name in $(env | cut -d= -f1 | sort); do
    case "$name" in
      MASSCOM_SHOWCASE_IMAGE_TAG) ;;
      SHOWCASE_* | COMPOSE_* | MASSCOM_SHOWCASE_* | OPENAI_API_KEY | AI_ART_*) seen="$seen $name" ;;
    esac
  done
  printf 'ENV %s:%s\n' "$1" "$seen" >>"$state/calls.log"
}
whitelisted_env() { # 컨테이너 이름 이름들: 템플릿이 걸러 내는 것처럼 지정한 이름의 줄만 낸다(끝에 빈 줄, docker가 붙이는 개행)
  local dir="$state/containers/$1" line n keep
  shift
  while IFS= read -r line; do
    n="${line%%=*}"
    for keep in "$@"; do
      if [[ "$n" == "$keep" ]]; then printf '%s\n' "$line"; fi
    done
  done <"$dir/env"
  printf '\n'
}

case "${1:-}" in
  ps)
    if [[ -f "$state/current" ]]; then cat "$state/current"; fi
    ;;
  inspect)
    id="$4"
    dir="$state/containers/$id"
    case "$3" in
      *'"OPENAI_API_KEY"'*) whitelisted_env "$id" OPENAI_API_KEY ;;
      *'"AI_ART_MONTHLY_BUDGET_USD"'*)
        whitelisted_env "$id" AI_ART_MONTHLY_BUDGET_USD AI_ART_DAILY_DRAFT_ROUNDS AI_ART_DAILY_FINALS \
          AI_ART_DRAFT_MODEL AI_ART_FINAL_MODEL AI_ART_STAFF_MAY_MANAGE ;;
      *Config.Env*) echo 'fake docker: unfiltered container environment dump requested' >&2; exit 1 ;;
      *) printf '%s|%s|%s|%s\n' "$(cat "$dir/image")" "$(cat "$dir/config_files")" "$(cat "$dir/health")" "$(cat "$dir/hash")" ;;
    esac
    ;;
  logs)
    cat "$state/containers/$2/log"
    ;;
  compose)
    shift
    if [[ "${1:-}" == version ]]; then echo 'Docker Compose version v2.0.0-fake'; exit 0; fi
    project=
    env_file=
    compose_path=
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -p) project="$2"; shift 2 ;;
        --env-file) env_file="$2"; shift 2 ;;
        -f) compose_path="$2"; shift 2 ;;
        *) break ;;
      esac
    done
    sub="$1"
    case "$sub" in
      config)
        shift
        format=yaml
        hash_service=
        quiet=0
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --quiet) quiet=1; shift ;;
            --format) format="$2"; shift 2 ;;
            --hash) hash_service="$2"; shift 2 ;;
            *) shift ;;
          esac
        done
        if [[ -n "$hash_service" ]]; then
          log_env config-hash
          printf '%s %s\n' "$hash_service" "$(fake_hash "$env_file" "$compose_path")"
        elif [[ "$quiet" == 1 ]]; then
          log_env config-quiet
          [[ ! -f "$state/config_fail" ]] || { echo 'fake config error' >&2; exit 1; }
        elif [[ "$format" == json ]]; then
          log_env config-json
          [[ ! -f "$state/json_fail" ]] || { echo 'fake json error' >&2; exit 1; }
          key_render="$(effective SHOWCASE_OPENAI_API_KEY "$env_file")"
          if [[ -f "$state/render_key" ]]; then key_render="$(cat "$state/render_key")"; fi
          {
            printf '{\n  "name": "masscom-showcase",\n  "services": {\n    "migrate": {\n      "environment": {\n'
            printf '        "DATABASE_URL": "postgresql://masscom_showcase@postgres:5432/masscom_showcase",\n'
            printf '        "%s": "DO_NOT_PRINT_FAKE_DATABASE_VALUE"\n      }\n    },\n' PGPASS"WORD"
            printf '    "showcase-api": {\n      "environment": {\n'
            printf '        "AI_ART_DAILY_DRAFT_ROUNDS": "%s",\n' "$(effective SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS "$env_file")"
            printf '        "AI_ART_DAILY_FINALS": "%s",\n' "$(effective SHOWCASE_AI_ART_DAILY_FINALS "$env_file")"
            printf '        "AI_ART_DRAFT_MODEL": "%s",\n' "$(effective SHOWCASE_AI_ART_DRAFT_MODEL "$env_file")"
            printf '        "AI_ART_FINAL_MODEL": "%s",\n' "$(effective SHOWCASE_AI_ART_FINAL_MODEL "$env_file")"
            printf '        "AI_ART_MONTHLY_BUDGET_USD": "%s",\n' "$(effective SHOWCASE_AI_ART_MONTHLY_BUDGET_USD "$env_file")"
            printf '        "AI_ART_STAFF_MAY_MANAGE": "true",\n        "NODE_ENV": "production",\n'
            printf '        "OPENAI_API_KEY": "%s",\n' "$key_render"
            printf '        "%s": "DO_NOT_PRINT_FAKE_DATABASE_VALUE"\n      },\n      "image": "masscom-showcase-api:%s"\n    }\n  }\n}\n' \
              PGPASS"WORD" "$(effective MASSCOM_SHOWCASE_IMAGE_TAG "$env_file")"
          }
        else
          echo 'fake docker: plain config output is never expected' >&2
          exit 1
        fi
        ;;
      up)
        log_env up
        printf 'UP tag=%s env-file=%s args=%s\n' "${MASSCOM_SHOWCASE_IMAGE_TAG:-}" "$env_file" "$*" >>"$state/calls.log"
        if [[ -f "$state/up_fail" ]]; then
          echo "fake compose failure while reading key $(effective SHOWCASE_OPENAI_API_KEY "$env_file")" >&2
          exit 1
        fi
        if [[ -f "$state/no_recreate" ]]; then exit 0; fi
        old="$(cat "$state/current")"
        new="c$(( $(cat "$state/counter") + 1 ))"
        echo "${new#c}" >"$state/counter"
        mkdir -p "$state/containers/$new"
        printf 'masscom-showcase-api:%s\n' "$(effective MASSCOM_SHOWCASE_IMAGE_TAG "$env_file")" >"$state/containers/$new/image"
        cp "$state/containers/$old/config_files" "$state/containers/$new/config_files"
        cat "$state/health" >"$state/containers/$new/health"
        fake_hash "$env_file" "$compose_path" >"$state/containers/$new/hash"
        key="$(effective SHOWCASE_OPENAI_API_KEY "$env_file")"
        if [[ -f "$state/up_wrong_key" ]]; then key='a-different-key-than-the-file'; fi
        {
          echo 'NODE_ENV=production'
          echo "DATABASE_URL=postgresql://masscom_showcase@postgres:5432/masscom_showcase"
          printf '%s=%s\n' PGPASS"WORD" DO_NOT_PRINT_FAKE_DATABASE_VALUE
          echo "OPENAI_API_KEY=$key"
          echo "AI_ART_MONTHLY_BUDGET_USD=$(effective SHOWCASE_AI_ART_MONTHLY_BUDGET_USD "$env_file")"
          echo "AI_ART_DAILY_DRAFT_ROUNDS=$(effective SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS "$env_file")"
          echo "AI_ART_DAILY_FINALS=$(effective SHOWCASE_AI_ART_DAILY_FINALS "$env_file")"
          echo "AI_ART_DRAFT_MODEL=$(effective SHOWCASE_AI_ART_DRAFT_MODEL "$env_file")"
          echo "AI_ART_FINAL_MODEL=$(effective SHOWCASE_AI_ART_FINAL_MODEL "$env_file")"
          echo 'AI_ART_STAFF_MAY_MANAGE=true'
        } >"$state/containers/$new/env"
        {
          echo 'migrations already applied'
          if [[ -f "$state/up_log_line" ]]; then cat "$state/up_log_line"
          elif [[ -n "$key" ]]; then echo 'AI store art: enabled'
          else echo 'AI store art: disabled (OPENAI_API_KEY is empty)'; fi
          echo 'api listening on 0.0.0.0:3000'
        } >"$state/containers/$new/log"
        echo "$new" >"$state/current"
        ;;
      *) echo "unexpected compose call: $*" >&2; exit 1 ;;
    esac
    ;;
  *) echo "unexpected docker call: $*" >&2; exit 1 ;;
esac
FAKE_DOCKER
chmod +x "$bin/docker"

# ---- 시험 도구 --------------------------------------------------------------------------------------

# 실행 중 컨테이너 c1의 config-hash 라벨을 다시 계산한다: 실행 중 컨테이너의 키·가게 그림 설정·이미지 태그를 고정한 현재 compose 설정의 해시.
pinned_hash() {
  local env_file="$state/containers/c1/env" line name value
  export MASSCOM_SHOWCASE_IMAGE_TAG=abc1234
  while IFS= read -r line; do
    name="${line%%=*}"
    value="${line#*=}"
    case "$name" in
      OPENAI_API_KEY) export SHOWCASE_OPENAI_API_KEY="$value" ;;
      AI_ART_MONTHLY_BUDGET_USD | AI_ART_DAILY_DRAFT_ROUNDS | AI_ART_DAILY_FINALS | AI_ART_DRAFT_MODEL | AI_ART_FINAL_MODEL)
        export "SHOWCASE_$name=$value" ;;
    esac
  done <"$env_file"
  FAKE_STATE="$state" "$bin/docker" compose -p masscom-showcase --env-file "$runtime" -f "$compose_file" config --hash showcase-api
}

refresh_hash() {
  local hash
  hash="$(pinned_hash)"
  echo "${hash##* }" >"$state/containers/c1/hash"
  : >"$state/calls.log"
}

# 컨테이너 c1의 환경 한 줄을 바꾼다(다른 줄은 그대로).
set_container_env() { # 이름 값
  local file="$state/containers/c1/env"
  grep -v "^$1=" "$file" >"$file.tmp" || true
  printf '%s=%s\n' "$1" "$2" >>"$file.tmp"
  mv "$file.tmp" "$file"
  refresh_hash
}

# 실행 중 컨테이너 c1을 만들고(키 없음·`disabled` 로그) runtime.env를 채운다. 인자: runtime.env 본문 줄들.
setup() {
  rm -rf -- "$state"
  mkdir -p "$state/containers/c1"
  echo 1 >"$state/counter"
  echo c1 >"$state/current"
  echo healthy >"$state/health"
  echo 'masscom-showcase-api:abc1234' >"$state/containers/c1/image"
  echo "$compose_file" >"$state/containers/c1/config_files"
  echo healthy >"$state/containers/c1/health"
  printf 'NODE_ENV=production\nOPENAI_API_KEY=\nAI_ART_MONTHLY_BUDGET_USD=\nAI_ART_DAILY_DRAFT_ROUNDS=\nAI_ART_DAILY_FINALS=\nAI_ART_DRAFT_MODEL=\nAI_ART_FINAL_MODEL=\nAI_ART_STAFF_MAY_MANAGE=true\n' \
    >"$state/containers/c1/env"
  printf '%s\n' "$(printf 'PGPASS%s=%s' WORD DO_NOT_PRINT_FAKE_DATABASE_VALUE)" >>"$state/containers/c1/env"
  printf 'AI store art: disabled (OPENAI_API_KEY is empty)\n' >"$state/containers/c1/log"
  : >"$state/calls.log"
  printf 'services: {}\n' >"$compose_file"
  rm -f "$runtime"
  printf '%s\n' "$@" >"$runtime"
  chmod 600 "$runtime"
  refresh_hash
}

extra_env=''
shell_flags=''
run_script() {
  local status=0
  # shellcheck disable=SC2086
  env $extra_env FAKE_STATE="$state" PATH="$bin:$PATH" MASSCOM_SHOWCASE_ROOT="$root" \
    bash $shell_flags "$script" "$@" >"$out" 2>&1 || status=$?
  extra_env=''
  shell_flags=''
  return "$status"
}

expect_fail() {
  local label="$1"; shift
  if run_script "$@"; then
    echo "expected failure: $label" >&2
    cat "$out" >&2
    exit 1
  fi
}

expect_ok() {
  local label="$1"; shift
  if ! run_script "$@"; then
    echo "expected success: $label" >&2
    cat "$out" >&2
    exit 1
  fi
}

no_key_leak() {
  if grep -qF -- "$fake_key" "$out" || grep -qF -- "$other_key" "$out"; then
    echo "key value leaked into the output ($1)" >&2
    exit 1
  fi
  if grep -qF -- "$fake_key" "$state/calls.log" || grep -qF -- "$other_key" "$state/calls.log"; then
    echo "key value reached a docker command line ($1)" >&2
    exit 1
  fi
  if grep -q 'DO_NOT_PRINT_FAKE_DATABASE_VALUE' "$out"; then
    echo "another secret leaked into the output ($1)" >&2
    exit 1
  fi
}

no_up_call() {
  if grep -q '^UP ' "$state/calls.log"; then
    echo "compose up was called ($1)" >&2
    cat "$state/calls.log" >&2
    exit 1
  fi
}

no_docker_call() {
  if [[ -s "$state/calls.log" ]]; then
    echo "docker was called before the file checks passed ($1)" >&2
    cat "$state/calls.log" >&2
    exit 1
  fi
}

expect_text() {
  if ! grep -qF -- "$1" "$out"; then
    echo "output is missing: $1" >&2
    cat "$out" >&2
    exit 1
  fi
}

# compose를 부른 모든 호출은 프로젝트 이름을 고정하고, config·up 호출에는 SHOWCASE_*·COMPOSE_* 같은 변수가 넘어가지 않으며,
# 해시 계산에는 키와 가게 그림 설정 여섯 개만 넘어간다.
assert_compose_hygiene() {
  local line
  while IFS= read -r line; do
    case "$line" in
      'compose version') ;;
      'compose '*)
        [[ "$line" == 'compose -p masscom-showcase --env-file '* ]] || { echo "compose call without the fixed project: $line" >&2; exit 1; }
        ;;
    esac
  done <"$state/calls.log"
  if grep -E '^ENV (config-quiet|config-json|up):.+' "$state/calls.log" >/dev/null; then
    echo 'compose saw inherited variables' >&2
    grep '^ENV ' "$state/calls.log" >&2
    exit 1
  fi
  local hash_line name allowed='SHOWCASE_OPENAI_API_KEY SHOWCASE_AI_ART_MONTHLY_BUDGET_USD SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS SHOWCASE_AI_ART_DAILY_FINALS SHOWCASE_AI_ART_DRAFT_MODEL SHOWCASE_AI_ART_FINAL_MODEL'
  hash_line="$(grep '^ENV config-hash:' "$state/calls.log" || true)"
  for name in ${hash_line#ENV config-hash:}; do
    case " $allowed " in
      *" $name "*) ;;
      *) echo "the hash computation saw an unexpected variable: $name" >&2; exit 1 ;;
    esac
  done
}

container_key() { # 컨테이너 id의 OPENAI_API_KEY 값
  local line
  line="$(grep '^OPENAI_API_KEY=' "$state/containers/$1/env")"
  printf '%s' "${line#OPENAI_API_KEY=}"
}

base_env=(MASSCOM_SHOWCASE_IMAGE_TAG=abc1234)

# ---- 인자 --------------------------------------------------------------------------------------------
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
expect_fail 'no argument'
expect_fail 'unknown mode' restart
no_docker_call 'usage errors'

# ---- 키가 없거나 비어 있으면 아무것도 바꾸지 않는다 ----------------------------------------------------
setup "${base_env[@]}"
expect_fail 'enable without a key line' enable
expect_text 'ai-art refused'
no_docker_call 'missing key'

setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY='
expect_fail 'enable with an empty key' enable
no_docker_call 'empty key'

setup "${base_env[@]}" '# SHOWCASE_OPENAI_API_KEY=commented-out-value-is-not-a-key'
expect_fail 'enable with only a commented key' enable
no_docker_call 'commented key'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key with spaces"
expect_fail 'enable with a malformed key' enable
expect_text 'malformed'
no_key_leak 'malformed key'
no_docker_call 'malformed key'

setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY=키값키값키값'
expect_fail 'enable with a non-ASCII key' enable
expect_text 'malformed'
no_docker_call 'non-ASCII key'

setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY="quoted"inside'
expect_fail 'enable with quotes inside the value' enable
no_docker_call 'quotes inside the value'

# ---- compose는 받아들이지만 `^KEY=`로는 안 잡히는 줄은 모두 거절한다(스크립트가 compose와 다르게 읽지 못하게) ----
for variant in "export SHOWCASE_OPENAI_API_KEY=$fake_key" " SHOWCASE_OPENAI_API_KEY=$fake_key" \
  "SHOWCASE_OPENAI_API_KEY: $fake_key" "SHOWCASE_OPENAI_API_KEY = $fake_key" "	SHOWCASE_OPENAI_API_KEY=$fake_key"; do
  setup "${base_env[@]}" "$variant"
  expect_fail "enable with a non-canonical line: $variant" enable
  expect_text 'non-canonical'
  no_key_leak 'non-canonical line'
  no_docker_call 'non-canonical line'
done

# disable: 파일에는 빈 줄이 있고 뒤에 compose가 나중 줄로 쓰는 살아 있는 키 줄이 또 있다. `^KEY=`만 보면 비어 있다고 착각한다.
for later in "export SHOWCASE_OPENAI_API_KEY=$fake_key" "SHOWCASE_OPENAI_API_KEY: $fake_key" "SHOWCASE_OPENAI_API_KEY=$fake_key"; do
  setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY=' "$later"
  set_container_env OPENAI_API_KEY "$fake_key"
  expect_fail "disable with an earlier empty line and a later live line: $later" disable
  no_key_leak 'disable with a later live line'
  no_docker_call 'disable with a later live line'
done
# 반대로 살아 있는 줄 뒤에 빈 줄이 오는 중복도 거절한다(나중 줄이 이기므로 어느 쪽이든 모호하다).
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key" 'SHOWCASE_OPENAI_API_KEY='
expect_fail 'enable with a duplicate key line' enable
expect_text 'more than one line'
no_docker_call 'duplicate key line'

# 값 안의 `$`는 compose가 다른 변수로 치환하므로 거절한다.
for value in 'abc$DEF' 'abc${DEF}' '$fake'; do
  setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$value"
  expect_fail "enable with interpolation in the value: $value" enable
  expect_text 'contains $'
  no_docker_call 'interpolation'
done

# NUL 바이트가 든 runtime.env는 bash가 줄을 조용히 바꿀 수 있어 거절한다.
setup "${base_env[@]}"
printf 'SHOWCASE_OPENAI_API_KEY=abc\0def\n' >>"$runtime"
expect_fail 'enable with a NUL byte in runtime.env' enable
expect_text 'NUL bytes'
no_docker_call 'NUL byte'

# ---- runtime.env 권한이 600이 아니면 거절한다 ----------------------------------------------------------
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
chmod 644 "$runtime"
expect_fail 'enable with mode 644' enable
expect_text 'mode 600'
no_key_leak 'mode 644'
no_docker_call 'mode 644'
expect_fail 'status with mode 644' status
chmod 640 "$runtime"
expect_fail 'enable with mode 640' enable
no_docker_call 'mode 640'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
mv "$runtime" "$scratch/real-runtime.env"
ln -s "$scratch/real-runtime.env" "$runtime"
expect_fail 'enable with a symlinked runtime.env' enable
no_docker_call 'symlinked runtime.env'
rm -f "$runtime"

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
rm -f "$runtime"
expect_fail 'enable without runtime.env' enable
no_docker_call 'missing runtime.env'

# ---- 켜기: 키가 있으면 showcase-api만 다시 만들고 enabled 로그를 확인한다 -----------------------------------
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
before_sha="$(shasum -a 256 "$runtime")"
expect_ok 'enable with a key' enable
expect_text 'AI store art: enabled'
expect_text "SHOWCASE_OPENAI_API_KEY: present (${#fake_key} chars, value not shown)"
expect_text 'monthly budget (USD, Korean month, showcase DB total): 5 (default)'
expect_text 'daily draft rounds per store: 3 (default)'
expect_text 'daily finals per store: 3 (default)'
expect_text 'ENABLED'
no_key_leak 'enable'
[[ "$(shasum -a 256 "$runtime")" == "$before_sha" ]] || { echo 'runtime.env was modified' >&2; exit 1; }
[[ "$(grep -c '^UP ' "$state/calls.log")" == 1 ]] || { echo 'expected exactly one compose up' >&2; exit 1; }
up_line="$(grep '^UP ' "$state/calls.log")"
[[ "$up_line" == "UP tag=abc1234 env-file=$runtime args=up -d --no-deps --no-build --pull never --force-recreate --wait --wait-timeout 180 showcase-api" ]] || {
  echo "unexpected compose up call: $up_line" >&2
  exit 1
}
assert_compose_hygiene
[[ "$(container_key c2)" == "$fake_key" ]] || { echo 'the recreated container does not carry the file key' >&2; exit 1; }
# 컨테이너를 만들고 지우는 그 밖의 호출은 없다(down·rm·stop·restart·build 없음).
if grep -Eq '(^| )(down|rm|stop|restart|build|kill)( |$)' "$state/calls.log"; then
  echo 'unexpected destructive docker call' >&2
  cat "$state/calls.log" >&2
  exit 1
fi

# 물려받은 셸 변수(sudo -E 등)와 COMPOSE_PROJECT_NAME은 compose에 닿지 않는다: 컨테이너는 파일의 키를 받는다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
extra_env="SHOWCASE_OPENAI_API_KEY=$other_key COMPOSE_PROJECT_NAME=other SHOWCASE_INVITED_SUBJECT_SHA256=zzz OPENAI_API_KEY=$other_key AI_ART_DAILY_FINALS=1 COMPOSE_FILE=/nonexistent/compose.yml"
expect_ok 'enable with inherited shell variables' enable
no_key_leak 'inherited variables'
[[ "$(container_key c2)" == "$fake_key" ]] || { echo 'an inherited variable overrode the file key' >&2; exit 1; }
assert_compose_hygiene
expect_text 'daily finals per store: 3 (default)'

setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY='
set_container_env OPENAI_API_KEY "$fake_key"
extra_env="SHOWCASE_OPENAI_API_KEY=$other_key"
expect_ok 'disable while a live key is inherited from the shell' disable
[[ -z "$(container_key c2)" ]] || { echo 'disable kept an inherited key' >&2; exit 1; }
no_key_leak 'disable with an inherited key'
assert_compose_hygiene

# `bash -x`·SHELLOPTS=xtrace로 불려도 키가 추적 출력에 찍히지 않는다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
shell_flags='-x'
expect_ok 'enable under bash -x' enable
no_key_leak 'bash -x'
expect_text 'AI store art: enabled'
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
extra_env='SHELLOPTS=xtrace'
expect_ok 'enable under SHELLOPTS=xtrace' enable
no_key_leak 'SHELLOPTS=xtrace'
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
set_container_env OPENAI_API_KEY "$fake_key"
printf 'AI store art: enabled\n' >"$state/containers/c1/log"
shell_flags='-x'
expect_ok 'status under bash -x' status
no_key_leak 'bash -x status'
setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY='
shell_flags='-x'
expect_ok 'disable under bash -x' disable
no_key_leak 'bash -x disable'

# 선택 한도 값이 runtime.env에 있으면 유효 한도로 보여 준다. 태그가 어긋나도 실행 중인 태그를 그대로 쓰고 해시 검사도 통과한다.
setup MASSCOM_SHOWCASE_IMAGE_TAG=fffffff "SHOWCASE_OPENAI_API_KEY=$fake_key" \
  SHOWCASE_AI_ART_MONTHLY_BUDGET_USD=4 SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS=2 SHOWCASE_AI_ART_DAILY_FINALS=1
expect_ok 'enable with custom limits and a drifted runtime tag' enable
expect_text 'monthly budget (USD, Korean month, showcase DB total): 4'
expect_text 'daily draft rounds per store: 2'
expect_text 'daily finals per store: 1'
expect_text 'note: runtime.env image tag (fffffff) differs from the running tag; keeping the running tag abc1234'
grep -q '^UP tag=abc1234 ' "$state/calls.log" || { echo 'the running image tag was not pinned' >&2; exit 1; }
no_key_leak 'custom limits'

# 키 바꾸기: 실행 중인 컨테이너에는 옛 키가 있고 파일에는 새 키가 있다. 바뀌는 것은 키뿐이라 해시 검사를 통과한다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$other_key"
set_container_env OPENAI_API_KEY "$fake_key"
expect_ok 'enable that replaces the running key' enable
[[ "$(container_key c2)" == "$other_key" ]] || { echo 'the key was not replaced' >&2; exit 1; }
no_key_leak 'key replacement'

# 키에 따옴표가 있어도 값은 출력에 나오지 않는다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=\"$fake_key\""
expect_ok 'enable with a quoted key' enable
no_key_leak 'quoted key'

# 키에 허용된 특수 글자(+ / = . : ~)도 그대로 통과한다.
special='abc.DEF_123:ghi~jkl+mno/pqr=stu-vwx'
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$special"
expect_ok 'enable with allowed special characters' enable
[[ "$(container_key c2)" == "$special" ]] || { echo 'special characters were altered' >&2; exit 1; }

# ---- compose가 렌더한 설정이 파일과 다르면 거절한다(스크립트와 compose가 다르게 읽는 경우의 마지막 방어선) -----------------
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
printf '%s' "$other_key" >"$state/render_key"
expect_fail 'enable when compose would pass another key' enable
expect_text 'different OPENAI_API_KEY'
no_up_call 'rendered key differs'
no_key_leak 'rendered key differs'

setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY='
printf '%s' "$other_key" >"$state/render_key"
expect_fail 'disable when compose would still pass a key' disable
expect_text 'non-empty OPENAI_API_KEY'
no_up_call 'disable with a rendered key'
no_key_leak 'disable with a rendered key'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
touch "$state/json_fail"
expect_fail 'enable when compose cannot render JSON' enable
expect_text 'compose config --format json failed'
no_up_call 'json failure'

# 다른 한도 값에 키가 섞여 들어가도(보간 우회) 거절하고 출력에 남기지 않는다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key" "SHOWCASE_AI_ART_DRAFT_MODEL=$fake_key"
expect_fail 'enable whose model name is the key' enable
expect_text 'contains the key'
no_key_leak 'model name is the key'
no_up_call 'model name is the key'

# ---- 한도 값은 API 범위 안이어야 한다(바꾸기 전 검사) ----------------------------------------------------
for bad in SHOWCASE_AI_ART_MONTHLY_BUDGET_USD=1001 SHOWCASE_AI_ART_MONTHLY_BUDGET_USD=1000.5 SHOWCASE_AI_ART_MONTHLY_BUDGET_USD=abc \
  SHOWCASE_AI_ART_MONTHLY_BUDGET_USD=5.1234567 SHOWCASE_AI_ART_MONTHLY_BUDGET_USD=-1 SHOWCASE_AI_ART_DAILY_FINALS=51 \
  SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS=-1 SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS=1.5 'SHOWCASE_AI_ART_DRAFT_MODEL=bad model!' \
  SHOWCASE_AI_ART_FINAL_MODEL=model/with/slash; do
  setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key" "$bad"
  expect_fail "enable with an out-of-range limit: $bad" enable
  expect_text 'nothing was changed'
  no_up_call "limit $bad"
done
# 소유자가 키를 비운 채 한도만 잘못 적어 둬도 disable은 바꾸기 전에 거절한다.
setup "${base_env[@]}" SHOWCASE_AI_ART_DAILY_FINALS=51
expect_fail 'disable with an out-of-range limit' disable
no_up_call 'disable with a bad limit'
for good in SHOWCASE_AI_ART_MONTHLY_BUDGET_USD=1000 SHOWCASE_AI_ART_MONTHLY_BUDGET_USD=0 SHOWCASE_AI_ART_MONTHLY_BUDGET_USD=0.000001 \
  SHOWCASE_AI_ART_DAILY_FINALS=50 SHOWCASE_AI_ART_DAILY_FINALS=0 SHOWCASE_AI_ART_DRAFT_MODEL=gpt-image-2.5-flare; do
  setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key" "$good"
  expect_ok "enable with an in-range limit: $good" enable
done

# ---- 켜기 실패: 로그에 enabled가 없으면 실패한다 --------------------------------------------------------
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
echo 'AI store art: disabled (invalid configuration)' >"$state/up_log_line"
expect_fail 'enable whose log is not enabled' enable
expect_text 'disabled (invalid configuration)'
expect_text "startup log is not 'AI store art: enabled'"
no_key_leak 'log not enabled'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
echo 'api listening on 0.0.0.0:3000' >"$state/up_log_line"
expect_fail 'enable whose log has no AI store art line' enable
expect_text "no known 'AI store art:' line found"

# 줄 전체가 알려진 세 줄과 같아야 한다: 다른 글 사이에 든 문구는 인정하지 않는다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
echo 'note: AI store art: enabled (not the startup line)' >"$state/up_log_line"
expect_fail 'enable whose log only mentions the phrase inside another line' enable
expect_text "no known 'AI store art:' line found"

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
touch "$state/no_recreate"
expect_fail 'enable that did not recreate the container' enable
expect_text 'was not recreated'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
echo starting >"$state/health"
expect_fail 'enable whose new container is not healthy' enable
expect_text 'not healthy'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
touch "$state/up_wrong_key"
expect_fail 'enable whose new container carries another key' enable
expect_text 'does not carry the runtime.env key'
no_key_leak 'wrong key in the new container'

# compose up 실패 메시지에 키가 섞여도 가려서 보여 준다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
touch "$state/up_fail"
expect_fail 'compose up failure' enable
expect_text '[redacted]'
no_key_leak 'compose up failure'

# ---- 바꾸기 전 검사: 실행 중 컨테이너·compose 설정 ------------------------------------------------------
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
rm -f "$state/current"
expect_fail 'enable without a running container' enable
expect_text 'found 0'
no_up_call 'no running container'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
printf 'c1\nc2\n' >"$state/current"
expect_fail 'enable with two running containers' enable
expect_text 'found 2'
no_up_call 'two containers'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
echo "$scratch/elsewhere/infra/showcase-host/compose.yml" >"$state/containers/c1/config_files"
expect_fail 'enable with a compose file outside the releases folder' enable
expect_text 'outside'
no_up_call 'foreign compose file'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
echo "$root/releases/../infra/showcase-host/compose.yml" >"$state/containers/c1/config_files"
expect_fail 'enable with a traversal compose path' enable
no_up_call 'traversal compose path'

# 릴리스 폴더가 심볼릭 링크면(다른 곳을 가리킬 수 있어) 거절한다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
ln -s "$release" "$root/releases/linked"
echo "$root/releases/linked/infra/showcase-host/compose.yml" >"$state/containers/c1/config_files"
expect_fail 'enable with a release folder that is a symbolic link' enable
expect_text 'symbolic link'
no_up_call 'symlinked release folder'
rm -f "$root/releases/linked"

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
echo 'nginx:latest' >"$state/containers/c1/image"
expect_fail 'enable with an unexpected image' enable
expect_text 'running image is not masscom-showcase-api'
no_up_call 'unexpected image'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
touch "$state/config_fail"
expect_fail 'enable when compose config does not render' enable
expect_text 'nothing was changed'
no_up_call 'config failure'

# ---- 키 말고 다른 설정이 어긋나 있으면 거절한다(config-hash) ---------------------------------------------
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
printf 'SHOWCASE_INVITED_SUBJECT_SHA256=%s\n' aaaaaaaa >>"$runtime"
expect_fail 'enable with unrelated runtime.env drift' enable
expect_text 'config drift'
expect_text 'nothing was changed'
no_up_call 'unrelated env drift'
no_key_leak 'env drift'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
printf '# changed after the container was created\n' >>"$compose_file"
expect_fail 'enable with compose file drift' enable
expect_text 'config drift'
no_up_call 'compose file drift'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
: >"$state/containers/c1/hash"
expect_fail 'enable when the running container has no config-hash label' enable
expect_text 'no compose config-hash label'
no_up_call 'missing hash label'

setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY='
set_container_env OPENAI_API_KEY "$fake_key"
printf 'SHOWCASE_INVITED_SUBJECT_SHA256=%s\n' bbbbbbbb >>"$runtime"
expect_fail 'disable with unrelated runtime.env drift' disable
expect_text 'config drift'
no_up_call 'disable with drift'

# ---- 끄기 ---------------------------------------------------------------------------------------------
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
expect_fail 'disable while the key line is still set' disable
expect_text 'removed or emptied'
no_key_leak 'disable with key'
no_docker_call 'disable with key'

setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY='
set_container_env OPENAI_API_KEY "$fake_key"
printf 'AI store art: enabled\n' >"$state/containers/c1/log"
before_sha="$(shasum -a 256 "$runtime")"
expect_ok 'disable with an empty key' disable
expect_text 'AI store art: disabled (OPENAI_API_KEY is empty)'
expect_text 'DISABLED'
[[ "$(shasum -a 256 "$runtime")" == "$before_sha" ]] || { echo 'runtime.env was modified by disable' >&2; exit 1; }
[[ "$(grep -c '^UP ' "$state/calls.log")" == 1 ]] || { echo 'expected one compose up for disable' >&2; exit 1; }
[[ -z "$(container_key c2)" ]] || { echo 'disable did not empty the key' >&2; exit 1; }
no_key_leak 'disable'
assert_compose_hygiene

setup "${base_env[@]}"
expect_ok 'disable with the key line removed' disable
expect_text 'SHOWCASE_OPENAI_API_KEY: absent'

setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY='
echo 'AI store art: enabled' >"$state/up_log_line"
expect_fail 'disable whose log still says enabled' disable
expect_text "startup log is not 'AI store art: disabled (OPENAI_API_KEY is empty)'"

# ---- status는 읽기 전용이다 ---------------------------------------------------------------------------
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
set_container_env OPENAI_API_KEY "$fake_key"
set_container_env AI_ART_MONTHLY_BUDGET_USD 3
printf 'AI store art: enabled\n' >"$state/containers/c1/log"
before_sha="$(shasum -a 256 "$runtime")"
expect_ok 'status enabled' status
expect_text 'state: ENABLED'
expect_text "image tag: abc1234"
expect_text "release dir: $release"
expect_text 'running container OPENAI_API_KEY: set (same as the runtime.env line)'
expect_text 'monthly budget (USD, Korean month, showcase DB total): 3'
no_key_leak 'status'
[[ "$(shasum -a 256 "$runtime")" == "$before_sha" ]] || { echo 'runtime.env was modified by status' >&2; exit 1; }
if grep -Eq '^compose ' "$state/calls.log"; then
  echo 'status called docker compose' >&2
  cat "$state/calls.log" >&2
  exit 1
fi
if grep -Eq '^(ps|inspect|logs) ' "$state/calls.log"; then :; else echo 'status did not read the container' >&2; exit 1; fi
[[ "$(cat "$state/current")" == c1 ]] || { echo 'status changed the running container' >&2; exit 1; }

setup "${base_env[@]}"
expect_ok 'status disabled' status
expect_text 'state: DISABLED'
expect_text 'running container OPENAI_API_KEY: empty'
no_up_call 'status disabled'

# 키는 넣었지만 아직 다시 만들지 않은 상태를 알려 준다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
expect_ok 'status with a pending key' status
expect_text 'NEEDS_RECREATE_OR_CHECK'
no_key_leak 'status pending'
no_up_call 'status pending'

# 컨테이너의 키가 파일과 다르거나(키 바꿈 대기), 파일에서 지웠는데 컨테이너에 남아 있어도 알려 준다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$other_key"
set_container_env OPENAI_API_KEY "$fake_key"
printf 'AI store art: enabled\n' >"$state/containers/c1/log"
expect_ok 'status when the running key differs from the file' status
expect_text 'set (different from the runtime.env line)'
expect_text 'NEEDS_RECREATE_OR_CHECK'
no_key_leak 'status different key'

setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY='
set_container_env OPENAI_API_KEY "$fake_key"
printf 'AI store art: enabled\n' >"$state/containers/c1/log"
expect_ok 'status when the file key was removed but the container still has it' status
expect_text 'NEEDS_RECREATE_OR_CHECK'
no_key_leak 'status removed key'

# 키 줄이 비표준이면 status도 확인 필요로 알린다(읽기 전용, compose 미호출).
setup "${base_env[@]}" "export SHOWCASE_OPENAI_API_KEY=$fake_key"
expect_ok 'status with a non-canonical key line' status
expect_text 'non-canonical'
expect_text 'NEEDS_RECREATE_OR_CHECK'
no_key_leak 'status non-canonical'

# status는 컨테이너 환경 전체를 가져오지 않는다(가짜 docker가 걸러 내지 않은 덤프 요청을 거절한다): 위 모든 status 시험이 그 사실을 보증한다.

# ---- 스크립트 자체 --------------------------------------------------------------------------------------
bash -n "$script"
first_command="$(grep -v '^#' "$script" | grep -v '^[[:space:]]*$' | head -n 1)"
[[ "$first_command" == 'set +x' ]] || { echo 'the first command of enable-ai-art.sh must be set +x' >&2; exit 1; }
if grep -Eq '(^|[[:space:]])set -[a-z]*x' "$script"; then
  echo 'enable-ai-art.sh must never turn command tracing on (it handles a secret)' >&2
  exit 1
fi
if grep -Eq '(^|[[:space:]])!( )+grep' "$script"; then
  echo 'enable-ai-art.sh uses ! grep, which does not trip set -e' >&2
  exit 1
fi
# runtime.env를 읽는 grep은 모두 -a(바이너리도 텍스트로)다.
if grep -n 'grep' "$script" | grep -F '"$runtime_env"' | grep -Ev 'grep -[a-zA-Z]*a'; then
  echo 'a runtime.env read is missing grep -a' >&2
  exit 1
fi

echo 'enable-ai-art: enable, disable and status behave as specified (fake docker)'
