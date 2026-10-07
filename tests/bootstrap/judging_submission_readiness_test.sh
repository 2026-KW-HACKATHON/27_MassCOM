#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

require_text() {
  local file="$1" pattern="$2"
  if ! rg -q "$pattern" "$file"; then
    echo "missing submission evidence: $file ($pattern)" >&2
    exit 1
  fi
}

require_text docs/COMPETITION.md '2026-09-27.*PUBLIC.*완료'
require_text docs/SUBMISSION_CHECKLIST.md '\[x\].*2026-09-27.*PUBLIC'
require_text docs/EVALUATION_MAP.md 'D-023.*USER_CONFIRMED'
require_text docs/EVALUATION_MAP.md '2026-09-23.*API 82'
require_text docs/EVALUATION_MAP.md 'UI_BOARDS_QA_2026-10-07.md'
require_text docs/PRD.md 'RQ-025.*운영 Android.*Google 로그인.*시연 Android.*시연 웹.*임시 체험'
require_text docs/CONTRIBUTIONS.md '8b336ece'
require_text docs/CONTRIBUTIONS.md '팀 확인 필요'
require_text docs/CONTRIBUTIONS.md 'AI_USAGE.md'
while IFS= read -r row; do
  count="$(awk '{print $1}' <<< "$row")"
  author="${row#*$'\t'}"
  author="${author%% <*}"
  if (( count >= 1000 )); then count="${count:0:1},${count:1}"; fi
  require_text docs/CONTRIBUTIONS.md "$author.*$count"
done < <(git shortlog -sne 8b336ece)

echo 'judging submission readiness docs PASS'
