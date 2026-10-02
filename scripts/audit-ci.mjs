#!/usr/bin/env node
// `npm audit --omit=dev`를 현재 폴더에서 돌려 high·critical 권고가 하나라도 있으면 실패한다. 예외는
// scripts/audit-exceptions.json에 권고 ID·패키지·허용 의존 패키지·만료일을 모두 맞춘 것만 인정한다(D-066).
// 만료일이 지나거나, 같은 권고가 다른 패키지에서 들어오면 다시 실패한다.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);

function advisoryId(via) {
  const match = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/.exec(via.url ?? '');
  return match ? match[0] : String(via.source ?? via.title ?? 'unknown');
}

/** report: `npm audit --json` 결과, exceptions: 예외 목록, today: 'YYYY-MM-DD'(UTC). */
export function evaluateAudit(report, exceptions, today) {
  if (!report || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    return { failures: ['npm audit 결과를 읽지 못했습니다.'], excused: [] };
  }
  const failures = [];
  const excused = [];
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    for (const via of entry.via ?? []) {
      // 문자열 via는 다른 패키지를 거친 전이 경로다. 실제 권고 객체만 판정한다.
      if (typeof via !== 'object' || via === null || !BLOCKING.has(via.severity)) continue;
      const id = advisoryId(via);
      const dependents = entry.effects ?? [];
      const rule = exceptions.find((item) => item.id === id && item.package === name);
      const label = `${id} (${name}, ${via.severity})`;
      if (!rule) {
        failures.push(`${label}: 예외 없음`);
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.expires ?? '') || !Array.isArray(rule.allowedDependents) || rule.allowedDependents.length === 0) {
        failures.push(`${label}: 예외 형식이 잘못됨(만료일·허용 의존 패키지 필요)`);
      } else if (entry.isDirect !== false) {
        // 앱이 직접 의존하면 번들에 들어갈 수 있다. npm은 직접 의존을 effects가 아니라 isDirect로 알린다.
        failures.push(`${label}: 앱의 직접 의존(또는 직접 여부 불명)`);
      } else if (today > rule.expires) {
        failures.push(`${label}: 예외가 ${rule.expires}에 만료됨`);
      } else if (dependents.length === 0 || !dependents.every((dependent) => rule.allowedDependents.includes(dependent))) {
        // 의존 패키지가 비면(직접 의존이 되었거나 npm이 경로를 못 밝힘) 허용 경로라고 볼 수 없다.
        failures.push(`${label}: 허용하지 않은 패키지가 의존함(${dependents.join(', ')})`);
      } else {
        excused.push(`${label}: ${rule.expires}까지 예외`);
      }
    }
  }
  return { failures, excused };
}

function main() {
  const exceptions = JSON.parse(readFileSync(new URL('./audit-exceptions.json', import.meta.url), 'utf8'));
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = undefined;
  }
  const { failures, excused } = evaluateAudit(report, exceptions, new Date().toISOString().slice(0, 10));
  for (const line of excused) console.log(`audit 예외: ${line}`);
  if (failures.length) {
    for (const line of failures) console.error(`audit 실패: ${line}`);
    process.exit(1);
  }
  console.log('audit: high·critical 권고 없음(예외 제외)');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
