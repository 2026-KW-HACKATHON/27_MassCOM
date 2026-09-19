#!/usr/bin/env bash

set -euo pipefail

title="${1:-}"
body="${2:-}"

if [[ -z "$title" || -z "$body" ]]; then
  echo "PR 제목과 본문은 비워 둘 수 없습니다." >&2
  exit 1
fi

if ! node -e 'const count=[...process.argv[1]].filter((char)=>/\p{Script=Hangul}/u.test(char)).length; process.exit(count >= 4 ? 0 : 1)' "$title"; then
  echo "PR 제목에는 의미 있는 한국어 문구가 필요합니다: $title" >&2
  exit 1
fi

if ! node -e 'const count=[...process.argv[1]].filter((char)=>/\p{Script=Hangul}/u.test(char)).length; process.exit(count >= 10 ? 0 : 1)' "$body"; then
  echo "PR 본문에는 한국어 검증 요약이 필요합니다." >&2
  exit 1
fi

echo "PR 한국어 작성 규칙 확인 완료"
