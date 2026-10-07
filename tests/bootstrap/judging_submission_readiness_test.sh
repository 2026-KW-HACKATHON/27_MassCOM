#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

require_text() {
  local file="$1" pattern="$2"
  if ! grep -Eq "$pattern" "$file"; then
    echo "missing submission evidence: $file ($pattern)" >&2
    exit 1
  fi
}

require_text docs/COMPETITION.md 'PUBLIC.*완료'
require_text docs/SUBMISSION_CHECKLIST.md '\[x\].*PUBLIC'
require_text docs/EVALUATION_MAP.md 'D-023.*USER_CONFIRMED'
require_text docs/EVALUATION_MAP.md '[0-9]{4}-[0-9]{2}-[0-9]{2}.*API [0-9]+'
require_text docs/EVALUATION_MAP.md '\]\(UI_BOARDS_QA_[0-9]{4}-[0-9]{2}-[0-9]{2}\.md\)'
require_text docs/PRD.md 'RQ-025.*운영 Android.*Google 로그인.*시연 Android.*시연 웹.*임시 체험'
require_text docs/CONTRIBUTIONS.md '^기준: `[0-9a-f]{7,40}`\([0-9]{4}-[0-9]{2}-[0-9]{2}\)'
require_text docs/CONTRIBUTIONS.md '팀 확인 필요'
require_text docs/CONTRIBUTIONS.md 'AI_USAGE.md'
require_text docs/CONTRIBUTIONS.md '^\| Git 작성자 표기 \| 커밋 \|'
require_text docs/CONTRIBUTIONS.md '^\| `[^`]+` \| [0-9]+(,[0-9]{3})* \|.*팀 확인 필요'

echo 'judging submission readiness docs PASS'
