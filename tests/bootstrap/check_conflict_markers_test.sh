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

# 표시 방향과 이름 유무를 하나씩 따로 남겨, 어느 한 경우만 놓쳐도 실패하게 한다.
for marker in "$open_marker HEAD" "$close_marker origin/main" "$open_marker" "$close_marker"; do
  printf '%s\n' 'before' "$marker" 'after' >"$fixture/conflicted.md"
  git -C "$fixture" add conflicted.md
  if bash "$checker" "$fixture" >/dev/null 2>&1; then
    echo "a leftover conflict marker was not reported: $marker" >&2
    exit 1
  fi
done
# 7개보다 긴 꺾쇠 줄이나 표시 뒤에 공백 없이 글자가 붙은 줄은 충돌 표시가 아니다.
printf '%s\n' "$open_marker<" "${close_marker}x" >"$fixture/conflicted.md"
git -C "$fixture" add conflicted.md
bash "$checker" "$fixture" >/dev/null || { echo 'non-marker angle lines were reported as conflicts' >&2; exit 1; }

if bash "$checker" "$fixture/not-a-repo" >/dev/null 2>&1; then
  echo 'a failed scan must not pass' >&2
  exit 1
fi
echo 'conflict marker check tests passed'
