#!/usr/bin/env bash
# 충돌 표시 검사가 남은 표시를 잡고, 정상 파일과 Markdown 구분선은 통과시키는지 확인한다.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="$repo_root/scripts/check-conflict-markers.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

git -C "$fixture" init -q
open_marker="$(printf '<%.0s' 1 2 3 4 5 6 7)"
close_marker="$(printf '>%.0s' 1 2 3 4 5 6 7)"
printf '%s\n' '# 문서' '' '| 열 | 값 |' '| --- | --- |' '=======' 'ordinary text' >"$fixture/clean.md"
git -C "$fixture" add clean.md
bash "$checker" "$fixture" >/dev/null || { echo 'clean files were reported as conflicted' >&2; exit 1; }

printf '%s\n' "$open_marker HEAD" 'ours' '=======' 'theirs' "$close_marker origin/main" >"$fixture/conflicted.md"
git -C "$fixture" add conflicted.md
if bash "$checker" "$fixture" >/dev/null 2>&1; then
  echo 'a leftover conflict marker was not reported' >&2
  exit 1
fi

if bash "$checker" "$fixture/not-a-repo" >/dev/null 2>&1; then
  echo 'a failed scan must not pass' >&2
  exit 1
fi
echo 'conflict marker check tests passed'
