#!/usr/bin/env bash
# infra/showcase-host/enable-ai-art.sh 시험(Issue #256). PATH의 가짜 docker로 실제 Docker·OpenAI 없이 켜기·끄기·상태 흐름을 확인한다.
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
out="$scratch/out.log"
mkdir -p "$bin" "$release/infra/showcase-host" "$root"
: >"$compose_file"

# ---- 가짜 docker: 호출을 기록하고 상태 폴더의 컨테이너를 흉내 낸다 -------------------------------------
cat >"$bin/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
state="${FAKE_STATE:?}"
printf '%s\n' "$*" >>"$state/calls.log"
env_value() { local line; line="$(grep -E "^$2=" "$1" | tail -n 1 || true)"; printf '%s' "${line#"$2="}"; }
case "${1:-}" in
  ps)
    if [[ -f "$state/current" ]]; then cat "$state/current"; fi
    ;;
  inspect)
    dir="$state/containers/$4"
    case "$3" in
      *Config.Env*) cat "$dir/env" ;;
      *) printf '%s|%s|%s\n' "$(cat "$dir/image")" "$(cat "$dir/config_files")" "$(cat "$dir/health")" ;;
    esac
    ;;
  logs)
    cat "$state/containers/$2/log"
    ;;
  compose)
    shift
    version_only=0
    env_file=
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --env-file) env_file="$2"; shift 2 ;;
        -f) shift 2 ;;
        version) version_only=1; break ;;
        *) break ;;
      esac
    done
    if [[ "$version_only" == 1 ]]; then echo 'Docker Compose version v2.0.0-fake'; exit 0; fi
    sub="$1"
    case "$sub" in
      config)
        [[ ! -f "$state/config_fail" ]] || { echo 'fake config error' >&2; exit 1; }
        ;;
      up)
        printf 'UP tag=%s env-file=%s args=%s\n' "${MASSCOM_SHOWCASE_IMAGE_TAG:-}" "$env_file" "$*" >>"$state/calls.log"
        if [[ -f "$state/up_fail" ]]; then
          echo "fake compose failure while reading key $(env_value "$env_file" SHOWCASE_OPENAI_API_KEY)" >&2
          exit 1
        fi
        if [[ -f "$state/no_recreate" ]]; then exit 0; fi
        old="$(cat "$state/current")"
        new="c$(( $(cat "$state/counter") + 1 ))"
        echo "${new#c}" >"$state/counter"
        mkdir -p "$state/containers/$new"
        printf 'masscom-showcase-api:%s\n' "${MASSCOM_SHOWCASE_IMAGE_TAG:-local}" >"$state/containers/$new/image"
        cp "$state/containers/$old/config_files" "$state/containers/$new/config_files"
        cat "$state/health" >"$state/containers/$new/health"
        key="$(env_value "$env_file" SHOWCASE_OPENAI_API_KEY)"
        {
          echo 'NODE_ENV=production'
          echo "DATABASE_URL=postgresql://masscom_showcase@postgres:5432/masscom_showcase"
          printf '%s=%s\n' PGPASS"WORD" DO_NOT_PRINT_FAKE_DATABASE_VALUE
          echo "OPENAI_API_KEY=$key"
          echo "AI_ART_MONTHLY_BUDGET_USD=$(env_value "$env_file" SHOWCASE_AI_ART_MONTHLY_BUDGET_USD)"
          echo "AI_ART_DAILY_DRAFT_ROUNDS=$(env_value "$env_file" SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS)"
          echo "AI_ART_DAILY_FINALS=$(env_value "$env_file" SHOWCASE_AI_ART_DAILY_FINALS)"
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
  printf 'AI_ART_MONTHLY_BUDGET_USD=\nOPENAI_API_KEY=\n' >"$state/containers/c1/env"
  printf 'AI store art: disabled (OPENAI_API_KEY is empty)\n' >"$state/containers/c1/log"
  : >"$state/calls.log"
  rm -f "$runtime"
  printf '%s\n' "$@" >"$runtime"
  chmod 600 "$runtime"
}

run_script() {
  local status=0
  FAKE_STATE="$state" PATH="$bin:$PATH" MASSCOM_SHOWCASE_ROOT="$root" \
    bash "$script" "$@" >"$out" 2>&1 || status=$?
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
  if grep -qF -- "$fake_key" "$out"; then
    echo "key value leaked into the output ($1)" >&2
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
# 컨테이너를 만들고 지우는 그 밖의 호출은 없다(down·rm·stop·restart·build 없음).
if grep -Eq '(^| )(down|rm|stop|restart|build|kill)( |$)' "$state/calls.log"; then
  echo 'unexpected destructive docker call' >&2
  cat "$state/calls.log" >&2
  exit 1
fi

# 선택 한도 값이 runtime.env에 있으면 유효 한도로 보여 준다. 태그가 어긋나면 실행 중인 태그를 그대로 쓴다.
setup MASSCOM_SHOWCASE_IMAGE_TAG=fffffff "SHOWCASE_OPENAI_API_KEY=$fake_key" \
  SHOWCASE_AI_ART_MONTHLY_BUDGET_USD=4 SHOWCASE_AI_ART_DAILY_DRAFT_ROUNDS=2 SHOWCASE_AI_ART_DAILY_FINALS=1
expect_ok 'enable with custom limits and a drifted runtime tag' enable
expect_text 'monthly budget (USD, Korean month, showcase DB total): 4'
expect_text 'daily draft rounds per store: 2'
expect_text 'daily finals per store: 1'
expect_text 'note: runtime.env image tag (fffffff) differs from the running tag; keeping the running tag abc1234'
grep -q '^UP tag=abc1234 ' "$state/calls.log" || { echo 'the running image tag was not pinned' >&2; exit 1; }
no_key_leak 'custom limits'
# 비밀이 든 컨테이너 환경(PGPASSWORD 등)의 다른 값은 출력에 나오지 않는다.
if grep -q 'DO_NOT_PRINT_FAKE_DATABASE_VALUE' "$out"; then echo 'container env leaked' >&2; exit 1; fi

# 키에 따옴표가 있어도 값은 출력에 나오지 않는다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=\"$fake_key\""
expect_ok 'enable with a quoted key' enable
no_key_leak 'quoted key'

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
expect_text "no 'AI store art:' line found"

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
touch "$state/no_recreate"
expect_fail 'enable that did not recreate the container' enable
expect_text 'was not recreated'

setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
echo starting >"$state/health"
expect_fail 'enable whose new container is not healthy' enable
expect_text 'not healthy'

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

# ---- 끄기 ---------------------------------------------------------------------------------------------
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
expect_fail 'disable while the key line is still set' disable
expect_text 'removed or emptied'
no_key_leak 'disable with key'
no_docker_call 'disable with key'

setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY='
printf 'AI store art: enabled\n' >"$state/containers/c1/log"
before_sha="$(shasum -a 256 "$runtime")"
expect_ok 'disable with an empty key' disable
expect_text 'AI store art: disabled (OPENAI_API_KEY is empty)'
expect_text 'DISABLED'
[[ "$(shasum -a 256 "$runtime")" == "$before_sha" ]] || { echo 'runtime.env was modified by disable' >&2; exit 1; }
[[ "$(grep -c '^UP ' "$state/calls.log")" == 1 ]] || { echo 'expected one compose up for disable' >&2; exit 1; }

setup "${base_env[@]}"
expect_ok 'disable with the key line removed' disable
expect_text 'SHOWCASE_OPENAI_API_KEY: absent'

setup "${base_env[@]}" 'SHOWCASE_OPENAI_API_KEY='
echo 'AI store art: enabled' >"$state/up_log_line"
expect_fail 'disable whose log still says enabled' disable
expect_text "startup log is not 'AI store art: disabled (OPENAI_API_KEY is empty)'"

# ---- status는 읽기 전용이다 ---------------------------------------------------------------------------
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
printf 'AI store art: enabled\n' >"$state/containers/c1/log"
printf 'OPENAI_API_KEY=%s\nAI_ART_MONTHLY_BUDGET_USD=3\nAI_ART_DAILY_DRAFT_ROUNDS=\nAI_ART_DAILY_FINALS=\n' "$fake_key" >"$state/containers/c1/env"
before_sha="$(shasum -a 256 "$runtime")"
expect_ok 'status enabled' status
expect_text 'state: ENABLED'
expect_text "image tag: abc1234"
expect_text "release dir: $release"
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
no_up_call 'status disabled'

# 키는 넣었지만 아직 다시 만들지 않은 상태를 알려 준다.
setup "${base_env[@]}" "SHOWCASE_OPENAI_API_KEY=$fake_key"
expect_ok 'status with a pending key' status
expect_text 'NEEDS_RECREATE_OR_CHECK'
no_key_leak 'status pending'
no_up_call 'status pending'

# ---- 스크립트 자체 --------------------------------------------------------------------------------------
bash -n "$script"
if grep -Eq '(^|[[:space:]])set -[a-z]*x' "$script"; then
  echo 'enable-ai-art.sh must never trace commands (it handles a secret)' >&2
  exit 1
fi
if grep -Eq '(^|[[:space:]])!( )+grep' "$script"; then
  echo 'enable-ai-art.sh uses ! grep, which does not trip set -e' >&2
  exit 1
fi

echo 'enable-ai-art: enable, disable and status behave as specified (fake docker)'
