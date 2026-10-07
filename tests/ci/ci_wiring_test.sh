#!/usr/bin/env bash
# 시험 파일이 CI(.github/workflows/ci.yml)나 tools/gate.sh에서 실제로 실행되는지 확인한다.
# 만들어 놓고 연결하지 않은 시험은 아무도 모르게 안 돈다(Issue #410: 6개가 그랬다).
# 연결로 인정하는 것(주석 줄은 제외):
#   1. ci.yml·gate.sh에 시험 경로가 그대로 적혀 있다.
#   2. ci.yml·gate.sh의 tests/…* 글롭(예: tests/site/collectible-*.test.mjs)에 맞는다.
#   3. 이미 연결된 시험이 줄 맨 앞에서 bash/source/node로 부르거나 import한다(grep 패턴 안의 언급은 인정하지 않는다).
# bash + grep + awk만 쓴다: CI에 rg가 없고, macOS 기본 bash 3.2에서도 돌아야 한다.
# ponytail: 연결 사슬은 "이미 연결된 시험이 부른다"를 반복해 따라가지만, 변수로 조립한 경로는 못 본다. 그런 시험은 아래 목록이 아니라 ci.yml에 경로를 적는다.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

# CI에서 돌릴 수 없는 시험만 "경로 이유" 한 줄씩 적는다. 이유 없이 넣지 않는다. 지금은 없다.
# 예) tests/release/needs_android_device_test.sh 실제 Android 기기가 있어야 한다(CI에 없음)
exclusions=''

wiring="$(cat .github/workflows/ci.yml tools/gate.sh | grep -vE '^[[:space:]]*#' || true)"
globs="$(printf '%s\n' "$wiring" | grep -oE "tests/[^[:space:]\"']*\*[^[:space:]\"']*" || true)"
all="$(find tests \( -name '*_test.sh' -o -name '*.test.mjs' -o -name '*_test.mjs' \) | LC_ALL=C sort)"
[[ -n "$all" ]] || { echo 'no test files found under tests/' >&2; exit 1; }

is_excluded() { printf '%s\n' "$exclusions" | awk -v f="$1" '$1 == f { found = 1 } END { exit !found }'; }

in_wiring() {
  grep -qF -- "$1" <<<"$wiring" && return 0
  local glob
  while IFS= read -r glob; do
    # shellcheck disable=SC2053 # 오른쪽은 글롭 패턴이어야 한다
    if [[ -n "$glob" && "$1" == $glob ]]; then return 0; fi
  done <<<"$globs"
  return 1
}

invoked_by_covered() {
  local name="${1##*/}" caller
  name="${name//./\\.}"
  while IFS= read -r caller; do
    [[ -n "$caller" && "$caller" != "$1" ]] || continue
    if grep -qE "^[[:space:]]*(((bash|sh|source|node)[[:space:]]+(--test[[:space:]]+)?[\"']?[^[:space:]\"']*)|((await[[:space:]]+)?import[[:space:](]*[\"'].*))$name" "$caller"; then
      return 0
    fi
  done <<<"$covered"
  return 1
}

covered=''
pending=''
while IFS= read -r file; do
  if is_excluded "$file"; then continue; fi
  if in_wiring "$file"; then covered="$covered$file"$'\n'; else pending="$pending$file"$'\n'; fi
done <<<"$all"

changed=1
while [[ "$changed" == 1 ]]; do
  changed=0
  rest=''
  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    if invoked_by_covered "$file"; then covered="$covered$file"$'\n'; changed=1; else rest="$rest$file"$'\n'; fi
  done <<<"$pending"
  pending="$rest"
done

if [[ -n "${pending//[[:space:]]/}" ]]; then
  echo 'CI와 tools/gate.sh 어디에서도 실행되지 않는 시험 파일:' >&2
  printf '  %s\n' $pending >&2
  echo 'ci.yml에 연결하거나, 정말 CI에서 돌릴 수 없다면 이 파일의 exclusions에 이유와 함께 적는다.' >&2
  exit 1
fi

echo "CI 연결 확인: 시험 파일 $(printf '%s\n' "$all" | wc -l | tr -d ' ')개 모두 실행된다"
