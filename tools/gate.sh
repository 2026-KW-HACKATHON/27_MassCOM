#!/usr/bin/env bash
# 로컬 merge 전 빠른 검사. 전체 기준은 .github/workflows/ci.yml이며 이 스크립트가 CI를 대신하지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/check-secrets.sh
bash scripts/check-conflict-markers.sh
bash tests/bootstrap/check_conflict_markers_test.sh
bash tests/bootstrap/verify_bootstrap_test.sh
bash tests/bootstrap/verify_operations_docs_test.sh
bash tests/site/verify_evidence_consistency_test.sh
echo '로컬 빠른 검사 PASS. PR 제목·본문은 scripts/check-pr-korean.sh로, 나머지는 CI로 확인한다.'
