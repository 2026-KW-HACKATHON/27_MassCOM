import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// 계정 삭제 접수 서비스 두 개 중 어느 쪽이 켜지는지는 server.ts 시작 코드의 배선 두 줄에 달려 있다: 운영 웹(webAuth, 시연 아님)은 deletionIntake,
// 시연 서버(showcaseInvites)는 SHOWCASE_APP 출처의 showcaseDeletionIntake. 그 코드는 DB·비밀값 없이 실행할 수 없어(all-access-wiring.test.ts와 같다)
// 소스 본문에서 두 키의 값 식만 잘라 확인한다.
const source = readFileSync(fileURLToPath(new URL('./server.ts', import.meta.url)), 'utf8');
const code = source.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');

/** 4칸 들여쓴 객체 키 `key:`의 값 식을 다음 4칸 키 앞(또는 객체 끝)까지 돌려준다. */
function keyExpression(text: string, key: string): string {
  const starts = [...text.matchAll(new RegExp(`\\n    ${key}:`, 'g'))];
  assert.equal(starts.length, 1, `${key}: 키는 server.ts 시작 코드에 정확히 한 번 있어야 한다`);
  const from = starts[0]!.index! + `\n    ${key}:`.length;
  const next = text.slice(from).search(/\n    [A-Za-z]+:|\n  \};/);
  assert.notEqual(next, -1, `${key}: 값 식의 끝을 찾지 못했다`);
  return text.slice(from, from + next);
}

test('deletionIntake는 웹 로그인이 있고 시연 서버가 아닐 때만, 기본 출처로 만든다', () => {
  const expression = keyExpression(code, 'deletionIntake');
  assert.match(expression, /\bwebAuth\s*&&\s*!showcaseInvites\b/);
  assert.match(expression, /new PostgresAccountDeletionIntakeService\(/);
  assert.doesNotMatch(expression, /SHOWCASE_APP/);
});

test('showcaseDeletionIntake는 시연 서버(showcaseInvites)에서만 SHOWCASE_APP 출처로 만든다', () => {
  const expression = keyExpression(code, 'showcaseDeletionIntake');
  assert.match(expression, /\bshowcaseInvites\b/);
  assert.doesNotMatch(expression, /!showcaseInvites/);
  assert.doesNotMatch(expression, /\bwebAuth\b/);
  assert.match(expression, /new PostgresAccountDeletionIntakeService\([^)]*\{\s*source:\s*'SHOWCASE_APP'\s*\}\s*\)/);
});
