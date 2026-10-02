#!/usr/bin/env bash
# scripts/qa-local.sh가 자기 세션이 바꾼 apps/mobile/.env.local만 되돌리는지 확인한다(PR #308 리뷰 P1).
# 스크립트를 임시 저장소 모양 폴더에 복사하고 가짜 docker를 PATH 앞에 둬 실제 컨테이너·사용자 파일을 건드리지 않는다.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/repo/scripts" "$work/repo/apps/mobile" "$work/bin"
cp "$here/scripts/qa-local.sh" "$work/repo/scripts/qa-local.sh"
cat >"$work/bin/docker" <<'FAKE'
#!/usr/bin/env bash
# ps는 빈 목록, run은 실패(up이 .env.local에 닿기 전에 실패하는 경우), rm은 성공.
case "$1" in
  ps) exit 0 ;;
  run) exit 1 ;;
  *) exit 0 ;;
esac
FAKE
chmod +x "$work/bin/docker"

script="$work/repo/scripts/qa-local.sh"
env_file="$work/repo/apps/mobile/.env.local"
state="$work/repo/.tmp/qa-local"
fail=0
check() { if [[ "$1" == "$2" ]]; then echo "PASS $3"; else echo "FAIL $3 (got '$1', want '$2')"; fail=1; fi; }
run() { PATH="$work/bin:$PATH" bash "$script" "$@" >/dev/null 2>&1 || true; }

# 1. up 전에 down만 돌려도 사용자 .env.local은 그대로다.
printf 'USER=1\n' >"$env_file"
run down
check "$(cat "$env_file" 2>/dev/null || echo missing)" "USER=1" "down before up keeps user .env.local"

# 2. down을 두 번 돌려도 그대로다.
run down
check "$(cat "$env_file" 2>/dev/null || echo missing)" "USER=1" "repeated down keeps user .env.local"

# 3. up이 .env.local에 닿기 전에 실패하면(가짜 docker run 실패) 정리 뒤에도 그대로다.
run up
check "$(cat "$env_file" 2>/dev/null || echo missing)" "USER=1" "up failure before env write keeps user .env.local"

# 4. up이 바꾼 세션(표시+백업)은 down이 원래 파일로 되돌리고 상태를 지운다.
mkdir -p "$state"
cp "$env_file" "$state/mobile.env.local.bak"
: >"$state/mobile.env.local.owned"
printf 'QA=1\n' >"$env_file"
run down
check "$(cat "$env_file" 2>/dev/null || echo missing)" "USER=1" "owned session restores backup"
check "$(ls "$state" | grep -c 'mobile.env.local' || true)" "0" "owned session clears marker and backup"

# 5. up이 새로 만든 파일(표시만, 백업 없음)은 down이 지운다.
rm -f "$env_file"
: >"$state/mobile.env.local.owned"
printf 'QA=1\n' >"$env_file"
run down
check "$( [[ -e "$env_file" ]] && echo present || echo missing)" "missing" "owned session deletes the file it created"

exit "$fail"
