import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { evaluateAudit } from '../../scripts/audit-ci.mjs';

const forge = { url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv', severity: 'high', title: 'node-forge' };
const rule = {
  id: 'GHSA-86w9-cpqp-85rv', package: 'node-forge',
  levels: [['@expo/cli', '@expo/code-signing-certificates'], ['expo']],
  allowedRoots: ['expo'], expires: '2026-10-31',
};
const braces = { url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm', severity: 'high', title: 'braces' };
const bracesRule = {
  id: 'GHSA-vfj7-8cjw-p6xm', package: 'braces',
  levels: [['micromatch'], ['@expo/metro-file-map', 'metro-file-map']],
  allowedRoots: [], expires: '2026-10-31',
};
// /private/tmp/claude-501/audit-mobile.json에서 두 권고와 검사에 필요한 패키지만 복사했다.
// 두 번째 단계 이후 effects도 보존해 전체 순회로 되돌아가면 실패하게 한다.
const realAuditSubset = {
  "braces": {
    "name": "braces",
    "severity": "high",
    "isDirect": false,
    "via": [
      {
        "source": 1240992,
        "name": "braces",
        "dependency": "braces",
        "title": "braces vulnerable to stack-exhaustion denial of service through deeply nested patterns",
        "url": "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
        "severity": "high",
        "cwe": [
          "CWE-674"
        ],
        "cvss": {
          "score": 7.5,
          "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H"
        },
        "range": "<=3.0.3"
      }
    ],
    "effects": [
      "micromatch"
    ],
    "range": "*",
    "nodes": [
      "node_modules/braces"
    ],
    "fixAvailable": {
      "name": "react-native-reanimated",
      "version": "4.2.2",
      "isSemVerMajor": true
    }
  },
  "micromatch": {
    "name": "micromatch",
    "severity": "high",
    "isDirect": false,
    "via": [
      "braces"
    ],
    "effects": [
      "@expo/metro-file-map",
      "metro-file-map"
    ],
    "range": ">=0.2.0",
    "nodes": [
      "node_modules/micromatch"
    ],
    "fixAvailable": {
      "name": "react-native-reanimated",
      "version": "4.2.2",
      "isSemVerMajor": true
    }
  },
  "@expo/metro-file-map": {
    "name": "@expo/metro-file-map",
    "severity": "high",
    "isDirect": false,
    "via": [
      "micromatch"
    ],
    "effects": [
      "@expo/cli"
    ],
    "range": "*",
    "nodes": [
      "node_modules/@expo/metro-file-map"
    ],
    "fixAvailable": false
  },
  "metro-file-map": {
    "name": "metro-file-map",
    "severity": "high",
    "isDirect": false,
    "via": [
      "micromatch"
    ],
    "effects": [
      "@expo/metro",
      "metro"
    ],
    "range": "*",
    "nodes": [
      "node_modules/metro-config/node_modules/metro-file-map",
      "node_modules/metro-file-map"
    ],
    "fixAvailable": {
      "name": "react-native-reanimated",
      "version": "4.2.2",
      "isSemVerMajor": true
    }
  },
  "node-forge": {
    "name": "node-forge",
    "severity": "high",
    "isDirect": false,
    "via": [
      {
        "source": 1240912,
        "name": "node-forge",
        "dependency": "node-forge",
        "title": "node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements",
        "url": "https://github.com/advisories/GHSA-86w9-cpqp-85rv",
        "severity": "high",
        "cwe": [
          "CWE-347"
        ],
        "cvss": {
          "score": 7.5,
          "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N"
        },
        "range": "<=1.4.0"
      }
    ],
    "effects": [
      "@expo/cli",
      "@expo/code-signing-certificates"
    ],
    "range": "*",
    "nodes": [
      "node_modules/node-forge"
    ],
    "fixAvailable": false
  },
  "@expo/cli": {
    "name": "@expo/cli",
    "severity": "high",
    "isDirect": false,
    "via": [
      "@expo/code-signing-certificates",
      "@expo/config",
      "@expo/config-plugins",
      "@expo/inline-modules",
      "@expo/metro",
      "@expo/metro-config",
      "@expo/metro-file-map",
      "@expo/prebuild-config",
      "node-forge"
    ],
    "effects": [
      "expo"
    ],
    "range": "<=0.0.0-canary-20231123-1b19f96-4 || >=0.0.1-canary-20231125-d600e44",
    "nodes": [
      "node_modules/expo/node_modules/@expo/cli"
    ],
    "fixAvailable": false
  },
  "@expo/code-signing-certificates": {
    "name": "@expo/code-signing-certificates",
    "severity": "high",
    "isDirect": false,
    "via": [
      "node-forge"
    ],
    "effects": [],
    "range": "*",
    "nodes": [
      "node_modules/@expo/code-signing-certificates"
    ],
    "fixAvailable": true
  },
  "expo": {
    "name": "expo",
    "severity": "high",
    "isDirect": true,
    "via": [
      "@expo/cli",
      "@expo/config",
      "@expo/config-plugins",
      "@expo/local-build-cache-provider",
      "@expo/metro",
      "@expo/metro-config"
    ],
    "effects": [
      "react-native-nitro-google-signin"
    ],
    "range": ">=45.0.0-beta.1",
    "nodes": [
      "node_modules/expo"
    ],
    "fixAvailable": false
  }
};
const expoChain = () => structuredClone(realAuditSubset);
const report = (vulnerabilities) => ({ vulnerabilities });
const today = '2026-10-02';

test('the excepted advisory on its allowed path passes, transitive string vias are not judged again', () => {
  const result = evaluateAudit(report({
    'node-forge': { severity: 'high', isDirect: false, via: [forge], effects: ['@expo/cli', '@expo/code-signing-certificates'] },
    '@expo/cli': { severity: 'high', isDirect: false, via: ['node-forge', '@expo/code-signing-certificates'], effects: ['expo'] },
    '@expo/code-signing-certificates': { isDirect: false, via: ['node-forge'], effects: [] },
    expo: { isDirect: true, via: ['@expo/cli'], effects: [] },
    uuid: { severity: 'moderate', via: [{ url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq', severity: 'moderate' }], effects: ['xcode'] },
  }), [rule], today);
  assert.deepEqual(result.failures, []);
  assert.equal(result.excused.length, 1);
});

test('any other high or critical advisory fails', () => {
  const result = evaluateAudit(report({
    lodash: { severity: 'critical', via: [{ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'critical' }], effects: [] },
  }), [rule], today);
  assert.equal(result.failures.length, 1);
});

test('the exception stops working after it expires', () => {
  const result = evaluateAudit(report({
    'node-forge': { severity: 'high', isDirect: false, via: [forge], effects: ['@expo/cli'] },
  }), [rule], '2026-11-01');
  assert.match(result.failures[0], /만료/);
});

test('the same advisory reached through a package outside the allowed dependents fails', () => {
  const result = evaluateAudit(report({
    'node-forge': { severity: 'high', isDirect: false, via: [forge], effects: ['some-runtime-lib'] },
    'some-runtime-lib': { isDirect: true, via: ['node-forge'], effects: [] },
  }), [rule], today);
  assert.match(result.failures[0], /허용하지 않은/);
});

test('the excepted advisory with no recorded dependents (e.g. a direct dependency) fails', () => {
  const result = evaluateAudit(report({
    'node-forge': { severity: 'high', isDirect: false, via: [forge], effects: [] },
  }), [rule], today);
  assert.match(result.failures[0], /허용하지 않은/);
});

test('a direct dependency on the excepted package fails even on allowed paths', () => {
  const effects = ['@expo/cli', '@expo/code-signing-certificates'];
  assert.match(evaluateAudit(report({ 'node-forge': { severity: 'high', isDirect: true, via: [forge], effects } }), [rule], today).failures[0], /직접 의존/);
  assert.match(evaluateAudit(report({ 'node-forge': { severity: 'high', via: [forge], effects } }), [rule], today).failures[0], /직접 의존/);
});

test('a malformed exception never applies', () => {
  const entry = { 'node-forge': { severity: 'high', isDirect: false, via: [forge], effects: ['@expo/cli'] } };
  assert.match(evaluateAudit(report(entry), [{ ...rule, expires: undefined }], today).failures[0], /형식/);
  assert.match(evaluateAudit(report(entry), [{ ...rule, expires: '2026/10/31' }], today).failures[0], /형식/);
  assert.match(evaluateAudit(report(entry), [{ ...rule, levels: [] }], today).failures[0], /형식/);
  assert.match(evaluateAudit(report(entry), [{ ...rule, levels: [['@expo/cli']] }], today).failures[0], /형식/);
  assert.match(evaluateAudit(report(entry), [{ ...rule, levels: undefined }], today).failures[0], /형식/);
  assert.match(evaluateAudit(report(entry), [{ ...rule, allowedRoots: undefined }], today).failures[0], /형식/);
});

test('the same advisory id on a different package is not covered', () => {
  const result = evaluateAudit(report({
    'other-forge': { severity: 'high', via: [forge], effects: [] },
  }), [rule], today);
  assert.equal(result.failures.length, 1);
});

test('an unreadable audit report fails closed', () => {
  assert.equal(evaluateAudit(undefined, [rule], today).failures.length, 1);
  assert.equal(evaluateAudit({}, [rule], today).failures.length, 1);
});

test('micromatch 직접 의존은 braces 예외로 허용하지 않는다', () => {
  const chain = expoChain();
  chain.micromatch.isDirect = true;
  const result = evaluateAudit(report(chain), [bracesRule, rule], today);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /허용하지 않은 직접 의존.*micromatch/);
});

test('runtime-lib → micromatch → braces 경로는 허용하지 않는다', () => {
  const chain = expoChain();
  chain.micromatch.effects.push('runtime-lib');
  chain['runtime-lib'] = { isDirect: true, via: ['micromatch'], effects: [] };
  const result = evaluateAudit(report(chain), [bracesRule, rule], today);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /허용하지 않은 패키지.*runtime-lib/);
});

test('실제 braces·node-forge 두 단계 경로는 허용한다', () => {
  const result = evaluateAudit(report(expoChain()), [bracesRule, rule], today);
  assert.deepEqual(result.failures, []);
  assert.equal(result.excused.length, 2);
});

test('첫 번째 단계 effects가 허용 단계 밖으로 돌아오면 거절한다', () => {
  const chain = expoChain();
  chain.micromatch.effects.push('braces');
  const result = evaluateAudit(report(chain), [bracesRule, rule], today);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /허용하지 않은 패키지.*braces/);
});

test('첫 번째·두 번째 단계 패키지가 audit 목록에서 누락되면 거절한다', () => {
  for (const name of ['micromatch', '@expo/metro-file-map', 'metro-file-map', '@expo/cli', 'expo']) {
    const chain = expoChain();
    delete chain[name];
    const result = evaluateAudit(report(chain), [bracesRule, rule], today);
    assert.equal(result.excused.length < 2, true);
    assert.ok(result.failures.some((failure) => failure.includes(`audit 목록에 없음(${name})`)));
  }
});

test('두 번째 단계의 allowedRoots 밖 직접 의존은 거절한다', () => {
  const chain = expoChain();
  chain['@expo/metro-file-map'].isDirect = true;
  const result = evaluateAudit(report(chain), [bracesRule, rule], today);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /허용하지 않은 직접 의존.*@expo\/metro-file-map/);
});

test('허용된 expo 직접 루트 뒤의 런타임 패키지는 검사 범위 밖이다', () => {
  const chain = expoChain();
  chain['react-native-nitro-google-signin'] = { isDirect: true, via: ['expo'], effects: ['expo'] };
  const result = evaluateAudit(report(chain), [bracesRule, rule], today);
  assert.deepEqual(result.failures, []);
  assert.equal(result.excused.length, 2);
});

test('저장된 두 예외는 실제 모바일 audit 덤프의 관련 항목을 허용한다', () => {
  const exceptions = JSON.parse(readFileSync(new URL('../../scripts/audit-exceptions.json', import.meta.url), 'utf8'));
  const result = evaluateAudit(report(expoChain()), exceptions, today);
  assert.deepEqual(result.failures, []);
  assert.equal(result.excused.length, 2);
});

test('옛 allowedDependents·allowedChain만 있는 예외는 거절한다', () => {
  for (const fields of [{ allowedDependents: ['micromatch'] }, { allowedChain: ['micromatch'], allowedRoots: [] }]) {
    const oldRule = { id: bracesRule.id, package: 'braces', expires: bracesRule.expires, ...fields };
    assert.match(evaluateAudit(report({ braces: expoChain().braces }), [oldRule], today).failures[0], /형식/);
  }
});

test('첫 번째 단계의 직접 여부나 effects 형식이 불명확하면 거절한다', () => {
  for (const overrides of [{ isDirect: undefined }, { effects: undefined }, { effects: 'expo' }]) {
    const chain = expoChain();
    Object.assign(chain.micromatch, overrides);
    const result = evaluateAudit(report(chain), [bracesRule, rule], today);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /직접 여부 불명|경로 형식/);
  }
});

test('두 번째 단계의 effects는 더 순회하지 않는다', () => {
  const chain = expoChain();
  chain['metro-file-map'].effects = ['braces', 'runtime-lib'];
  chain['@expo/metro-file-map'].effects = undefined;
  const result = evaluateAudit(report(chain), [bracesRule, rule], today);
  assert.deepEqual(result.failures, []);
  assert.equal(result.excused.length, 2);
});

test('allowedRoots는 두 번째 단계에만 선언할 수 있다', () => {
  const invalidRules = [
    { ...rule, allowedRoots: ['@expo/cli'] },
    { ...rule, allowedRoots: ['runtime-lib'] },
    { ...rule, levels: [['@expo/cli', 'expo'], ['expo']] },
  ];
  for (const invalidRule of invalidRules) {
    const result = evaluateAudit(report({ 'node-forge': expoChain()['node-forge'] }), [invalidRule], today);
    assert.match(result.failures[0], /형식/);
  }
});

test('빈 allowedRoots는 유효하지만 expo 직접 의존까지 허용하지 않는다', () => {
  const result = evaluateAudit(report({
    'node-forge': expoChain()['node-forge'],
    '@expo/cli': expoChain()['@expo/cli'],
    '@expo/code-signing-certificates': expoChain()['@expo/code-signing-certificates'],
    expo: expoChain().expo,
  }), [{ ...rule, allowedRoots: [] }], today);
  assert.match(result.failures[0], /허용하지 않은 직접 의존.*expo/);
});

test('두 단계 배열의 잘못된 패키지 이름·추가 단계는 거절한다', () => {
  for (const levels of [[['@expo/cli'], 'expo'], [['@expo/cli'], ['expo'], []], [[null], ['expo']], [['@expo/cli'], ['']]]) {
    const result = evaluateAudit(report({ 'node-forge': expoChain()['node-forge'] }), [{ ...rule, levels }], today);
    assert.match(result.failures[0], /형식/);
  }
});
