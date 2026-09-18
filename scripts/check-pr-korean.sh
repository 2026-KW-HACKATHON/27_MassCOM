#!/usr/bin/env bash

set -euo pipefail

title="${1:-}"
body="${2:-}"

if [[ -z "$title" || -z "$body" ]]; then
  echo "PR 제목과 본문은 비워 둘 수 없습니다." >&2
  exit 1
fi

if ! node -e 'process.exit(/\p{Script=Hangul}/u.test(process.argv[1]) ? 0 : 1)' "$title"; then
  echo "PR 제목은 한국어를 기본으로 작성해야 합니다: $title" >&2
  exit 1
fi

if ! node -e 'process.exit(/\p{Script=Hangul}/u.test(process.argv[1]) ? 0 : 1)' "$body"; then
  echo "PR 본문은 한국어를 기본으로 작성해야 합니다." >&2
  exit 1
fi

echo "PR 한국어 작성 규칙 확인 완료"
