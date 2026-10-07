#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runbook="$repo_root/docs/DEMO_RUNBOOK.md"

node - "$runbook" <<'NODE'
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const doc = readFileSync(process.argv[2], 'utf8');

for (const section of ['## 공개 설치본 5분 시연', '## NFT 별도 증거', '## 3분 질의 대비 Q&A', '## 네트워크 장애 대체 순서']) {
  assert.ok(doc.includes(section), `${section} 누락`);
}
const five = doc.split('## 공개 설치본 5분 시연')[1]?.split('\n## ')[0] ?? '';
for (const step of ['로그인 없이 바로 체험', '동의', '테스트 방문', '봉투', '도감', '코인', '뽑기', '마이룸', '이웃', '점주 역할']) {
  assert.ok(five.includes(step), `5분 시연의 ${step} 누락`);
}
assert.match(doc, /`[0-9a-f]{7,40}`[\s\S]*Preview \d+[\s\S]*\b(PASS|FAIL|BLOCKED|NOT_RUN)\b/);
assert.match(doc, /Preview \d+[\s\S]*\/open/);
assert.match(doc, /`privacy-\d{4}-\d{2}-\d{2}`/);
assert.doesNotMatch(doc, /개인정보 처리방침 04 재동의/);
const qa = doc.split('## 3분 질의 대비 Q&A')[1]?.split('\n## ')[0] ?? '';
assert.ok((qa.match(/^\d+\. \*\*/gm) ?? []).length >= 8, '예상 질문 8개 이상 필요');
assert.match(qa, /\]\([^)]*\.md\)/, '질의 답변에 근거 문서 링크 필요');
NODE

echo 'demo submission readiness docs PASS'
