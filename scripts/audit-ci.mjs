#!/usr/bin/env node
// `npm audit --omit=dev`를 현재 폴더에서 돌려 high·critical 권고가 하나라도 있으면 실패한다. 예외는
// scripts/audit-exceptions.json의 권고 ID·패키지·만료일과 levels의 두 단계 의존 관계가 맞아야 한다(D-066·D-070).
// 첫 단계는 전이 의존만, 둘째 단계의 직접 의존은 allowedRoots만 허용한다. 누락된 패키지는 거절한다.
// npm의 effects 그래프는 react-native를 거쳐 빌드·런타임 의존을 구분하지 못하므로 두 단계까지만 검사한다.
// 만료일이 지나거나, 같은 권고가 다른 패키지에서 들어오면 다시 실패한다.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);

function advisoryId(via) {
  const match = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/.exec(via.url ?? '');
  return match ? match[0] : String(via.source ?? via.title ?? 'unknown');
}

/** 권고 패키지 위의 두 단계만 검사한다. 둘째 단계의 effects는 순회하지 않는다. */
function checkDependentLevels(vulnerabilities, name, rule) {
  const dependents = vulnerabilities[name].effects;
  if (!Array.isArray(dependents) || dependents.length === 0) {
    return '허용하지 않은 경로(의존 패키지 없음 또는 경로 불명)';
  }
  for (const dependent of dependents) {
    if (!rule.levels[0].includes(dependent)) return `첫 번째 단계에 허용하지 않은 패키지가 의존함(${dependent})`;
    if (!Object.hasOwn(vulnerabilities, dependent) || !vulnerabilities[dependent]) {
      return `첫 번째 단계 패키지가 audit 목록에 없음(${dependent})`;
    }
    const entry = vulnerabilities[dependent];
    if (entry.isDirect !== false) return `허용하지 않은 직접 의존(또는 직접 여부 불명: ${dependent})`;
    if (!Array.isArray(entry.effects)) return `첫 번째 단계 패키지 경로 형식이 잘못됨(${dependent})`;
    for (const parent of entry.effects) {
      if (!rule.levels[1].includes(parent)) return `두 번째 단계에 허용하지 않은 패키지가 의존함(${parent})`;
      if (!Object.hasOwn(vulnerabilities, parent) || !vulnerabilities[parent]) {
        return `두 번째 단계 패키지가 audit 목록에 없음(${parent})`;
      }
      const parentEntry = vulnerabilities[parent];
      if (typeof parentEntry.isDirect !== 'boolean') return `두 번째 단계 패키지 직접 여부 불명(${parent})`;
      if (parentEntry.isDirect === true && !rule.allowedRoots.includes(parent)) {
        return `허용하지 않은 직접 의존(${parent})`;
      }
    }
  }
  return undefined;
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
      const rule = exceptions.find((item) => item.id === id && item.package === name);
      const label = `${id} (${name}, ${via.severity})`;
      if (!rule) {
        failures.push(`${label}: 예외 없음`);
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.expires ?? '')
        || !Array.isArray(rule.levels) || rule.levels.length !== 2
        || !rule.levels.every((level) => Array.isArray(level) && level.every((packageName) => typeof packageName === 'string' && packageName.length > 0))
        || !Array.isArray(rule.allowedRoots)
        || !rule.allowedRoots.every((root) => rule.levels[1].includes(root) && !rule.levels[0].includes(root))) {
        failures.push(`${label}: 예외 형식이 잘못됨(만료일·두 단계 levels·둘째 단계의 allowedRoots 필요)`);
      } else if (entry.isDirect !== false) {
        // 앱이 직접 의존하면 번들에 들어갈 수 있다. npm은 직접 의존을 effects가 아니라 isDirect로 알린다.
        failures.push(`${label}: 앱의 직접 의존(또는 직접 여부 불명)`);
      } else if (today > rule.expires) {
        failures.push(`${label}: 예외가 ${rule.expires}에 만료됨`);
      } else {
        const failure = checkDependentLevels(report.vulnerabilities, name, rule);
        if (failure) failures.push(`${label}: ${failure}`);
        else excused.push(`${label}: ${rule.expires}까지 예외`);
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
