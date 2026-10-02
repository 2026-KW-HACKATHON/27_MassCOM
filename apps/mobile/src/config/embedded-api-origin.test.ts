import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

// Issue #325: 앱 소스에 운영·시연 API origin을 리터럴로 두면 모든 variant 번들에 들어가
// 릴리스 빌드 검사(scripts/check-embedded-api.sh, Issue #273)가 그 빌드를 막는다. 그 검사는
// 릴리스 빌드에서만 돌므로 같은 규칙을 CI에서 먼저 확인한다. API 주소는 EXPO_PUBLIC_API_URL로,
// 시연 전용 값은 app.config.ts의 시연 extra로만 넣는다.
// ponytail: 문자열 검사라 주석 안의 전체 origin도 잡는다. 주석에는 scheme 없이 호스트만 쓴다.
const sourceRoot = join(__dirname, '..');
const origins = ['https://api.masscom.kr', 'https://demo-api.masscom.kr'];
// 빌드 때 app.config.ts만 읽고 앱 번들에는 들어가지 않는 파일.
const buildTimeOnly = new Set(['config/build-environment.cjs']);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:[cm]?[jt]sx?|json)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test('app source never embeds an API origin literal', () => {
  const offenders = sourceFiles(sourceRoot)
    .map((path) => relative(sourceRoot, path).split('\\').join('/'))
    .filter((path) => !buildTimeOnly.has(path))
    .flatMap((path) => {
      const text = readFileSync(join(sourceRoot, path), 'utf8');
      return origins.filter((origin) => text.includes(origin)).map((origin) => `${path}: ${origin}`);
    });
  assert.deepEqual(offenders, []);
});
