#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="$repo_root/scripts/check-pr-korean.sh"

if [[ ! -x "$checker" ]]; then
  echo "expected executable Korean PR checker at $checker" >&2
  exit 1
fi

"$checker" \
  "Phase 1 외부 지갑 주소 확인 흐름 구현" \
  "외부 지갑 연결과 SIWE 서버 검증을 추가하고 실제 테스트 결과를 기록합니다."

if "$checker" "feat: add wallet link" "외부 지갑 연결을 구현합니다." >/dev/null 2>&1; then
  echo "Korean PR checker accepted an English-only title" >&2
  exit 1
fi

if "$checker" "외부 지갑 연결 구현" "Adds wallet verification flow." >/dev/null 2>&1; then
  echo "Korean PR checker accepted an English-only body" >&2
  exit 1
fi

echo "Korean PR language regression tests passed"
