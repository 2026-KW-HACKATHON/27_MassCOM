#!/usr/bin/env bash
# 병합 충돌 표시가 남은 추적 파일을 찾는다. 단독 "=======" 줄은 Markdown 구분선·표와 겹치므로 보지 않는다.
set -euo pipefail

root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

errors="$(mktemp)"
trap 'rm -f "$errors"' EXIT
set +e
matches="$(git -C "$root" grep -nIE '^(<{7}|>{7})( |$)' -- . 2>"$errors")"
status=$?
set -e

# git grep은 일부 읽기 오류에도 1(일치 없음)을 낼 수 있으므로, 오류 출력이 있으면 통과로 보지 않는다.
if [[ -s "$errors" ]]; then
  echo '충돌 표시 검사 중 오류가 났다:' >&2
  cat "$errors" >&2
  exit 2
fi

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
