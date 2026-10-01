#!/usr/bin/env bash
# 병합 충돌 표시가 남은 추적 파일을 찾는다. 단독 "=======" 줄은 Markdown 구분선·표와 겹치므로 보지 않는다.
set -euo pipefail

root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

set +e
matches="$(git -C "$root" grep -nIE '^(<{7}|>{7})( |$)' -- .)"
status=$?
set -e

if [[ $status -eq 0 ]]; then
  echo '병합 충돌 표시가 남아 있다:' >&2
  echo "$matches" >&2
  exit 1
fi
if [[ $status -ne 1 ]]; then
  echo '충돌 표시 검사를 실행하지 못했다(Git 저장소인지 확인).' >&2
  exit 2
fi
echo '병합 충돌 표시 없음'
