import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = join(repo, 'apps/showcase-web');
const verifier = join(repo, 'scripts/verify-showcase-site.py');
const run = (root) => spawnSync('python3', [verifier, root], { encoding: 'utf8' });

const fixtureHtml = `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="체험 도감">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'">
<link rel="stylesheet" href="assets/showcase.css"></head><body>
<p>체험용 가상 데이터로 서비스 흐름을 보여드립니다</p>
<main id="main"><section data-demo-merchant><p>가상 점포 · 실제 방문할 수 없습니다</p></section>
<section><p>예시 방문 기록</p><p>앱 안의 예시 수집품 · 실제 NFT가 아닙니다</p>
<p>앱의 체험 진행 결과와 자동으로 동기화되지 않습니다</p></section></main>
<footer><p>실제 운영 성과가 아닙니다</p></footer></body></html>`;

function withFixture(check) {
  const root = mkdtempSync(join(tmpdir(), 'masscom-showcase-'));
  try {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), fixtureHtml);
    writeFileSync(join(root, 'assets/showcase.css'), 'body { color: #102833; }');
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('정상 가상 페이지는 필수 고지와 비쓰기 경계를 통과한다', () => {
  withFixture((root) => assert.equal(run(root).status, 0));
});

test('실제 시연 웹은 읽기 전용 계약을 통과한다', () => {
  assert.equal(run(source).status, 0);
});

for (const [name, oldText, replacement, expectedError, file = 'index.html'] of [
  ['가상 점포 고지 제거', '가상 점포 · 실제 방문할 수 없습니다', '방문할 수 있습니다', '필수 문구 없음'],
  ['가짜 NFT 상태 추가', '</main>', '<p>FINALIZED</p></main>', '금지 문구'],
  ['가짜 발행 완료 추가', '</main>', '<p>발행 완료</p></main>', '금지 문구'],
  ['가짜 거래 해시 추가', '</main>', `<p>0x${'a'.repeat(40)}</p></main>`, '금지 문구'],
  ['쓰기 버튼 삽입', '</main>', '<button>방문 수령</button></main>', '허용되지 않은 태그'],
  ['쓰기 양식 삽입', '</main>', '<form action="/claim"></form></main>', '허용되지 않은 태그'],
  ['원격 스크립트 삽입', '</main>', '<script src="https://example.com/x.js"></script></main>', '허용되지 않은 태그'],
  ['이벤트 핸들러 삽입', '<main id="main">', '<main id="main" onclick="navigator.sendBeacon(\'/claim\')">', '허용되지 않은 속성'],
  ['실행 URL 삽입', '</main>', '<a href="javascript:alert(1)">보기</a></main>', '허용되지 않은 URL'],
  ['숨긴 고지', '가상 점포 · 실제 방문할 수 없습니다', '<span hidden>가상 점포 · 실제 방문할 수 없습니다</span>', '허용되지 않은 속성'],
  ['주석 고지', '가상 점포 · 실제 방문할 수 없습니다', '<!-- 가상 점포 · 실제 방문할 수 없습니다 -->', '필수 문구 없음'],
  ['외부 CSS 참조', '</main>', '</main>\n<link rel="stylesheet" href="https://example.com/x.css">', '허용되지 않은 URL'],
  ['외부 이동 meta refresh', '</head>', '<meta http-equiv="refresh" content="0; url=https://example.com/claim"></head>', '허용되지 않은 meta'],
  ['CSS import', 'body {', '@import url(https://example.com/x.css);\nbody {', '허용되지 않은 CSS', 'assets/showcase.css'],
  ['CSS 외부 이미지', 'body {', 'body { background-image: url(https://example.com/x.png);', '허용되지 않은 CSS', 'assets/showcase.css'],
]) {
  test(name, () => {
    withFixture((root) => {
      const target = join(root, file);
      const original = readFileSync(target, 'utf8');
      assert.ok(original.includes(oldText), `fixture 원문 없음: ${name}`);
      writeFileSync(target, original.replace(oldText, replacement));
      const result = run(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(expectedError));
    });
  });
}

export { source, run };
