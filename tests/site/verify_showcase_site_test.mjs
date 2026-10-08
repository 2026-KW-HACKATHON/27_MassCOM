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
const stores = JSON.parse(readFileSync(join(repo, 'apps/api/src/showcase/wolgye-stores.json'), 'utf8')).stores;
const run = (root) => spawnSync('python3', [verifier, root], { encoding: 'utf8' });

const fixtureHtml = `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="체험 도감">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'">
<link rel="stylesheet" href="assets/showcase.css?v=20260929"></head><body>
<p>가게 정보는 공공데이터에 등록된 실제 음식점입니다. 방문·도장·코인·혜택은 체험용 가상 데이터입니다</p>
<main id="main">${stores.map((store) => `<section data-demo-merchant><p>실제 가게 정보로 만든 시연 · 참여하지 않은 가게</p><h2>${store.name}</h2><p>${store.roadAddress}</p></section>`).join('')}
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

test('정상 월계 공공데이터 페이지는 필수 고지와 비쓰기 경계를 통과한다', () => {
  withFixture((root) => assert.equal(run(root).status, 0));
});

test('실제 시연 웹은 읽기 전용 계약을 통과한다', () => {
  assert.equal(run(source).status, 0);
});

test('실제 시연 웹은 월계 공공데이터 음식점 30곳을 표시한다', () => {
  const html = readFileSync(join(source, 'index.html'), 'utf8');
  assert.match(html, /href="assets\/showcase\.css\?v=20260929"/);
  assert.match(html, /role="group" aria-label="월계 가게 목록"/);
  assert.equal((html.match(/data-demo-merchant/g) ?? []).length, stores.length);
  const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll("'", '&#x27;');
  for (const { name } of stores) assert.ok(html.includes(escapeHtml(name)), name);
  const cards = [...html.matchAll(/<section class="merchant-card"[^>]*data-demo-merchant[^>]*>(.*?)<\/section>/gs)];
  assert.equal(cards.length, stores.length);
  assert.ok(cards.every((card, index) => card[1]?.includes('실제 가게 정보로 만든 시연 · 참여하지 않은 가게') && card[1]?.includes(escapeHtml(stores[index].name)) && card[1]?.includes(stores[index].roadAddress)));
  assert.match(html, /방문·도장·코인·혜택은 체험용 가상 데이터/);
  assert.doesNotMatch(html, /가상 점포 [ABC]/);
  assert.match(html, /갱스터떡볶이인덕대점·하다식당은 실제 가게 정보이며/);
});

test('README는 시연 웹·기존 수령 QR 실기와 새 식별 QR 미검증을 구분한다', () => {
  const readme = readFileSync(join(repo, 'README.md'), 'utf8');
  assert.ok(readme.includes('apps/showcase-web'));
  assert.ok(readme.includes('https://www.masscom.kr/preview/'));
  assert.ok(readme.includes('시연 Android 앱'));
  assert.ok(readme.includes('https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.2'));
  assert.match(readme, /두 계정[^\n]*직접 코드 수령[^\n]*이전 설치본 실증/);
  assert.ok(readme.includes('docs/evidence/showcase-preview3-camera-claim-2026-09-28.json'));
  assert.match(readme, /새 2분 식별 QR[^\n]*`NOT_RUN`/);
});

test('README의 점포별 수집품 그림은 저장소의 정사각 PNG를 가리킨다', () => {
  const readme = readFileSync(join(repo, 'README.md'), 'utf8');
  for (const merchant of ['a', 'b', 'c']) {
    const asset = `apps/mobile/assets/images/collectibles/showcase-${merchant}.png`;
    assert.ok(readme.includes(`src="${asset}"`), asset);
    const image = readFileSync(join(repo, asset));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', asset);
    assert.equal(image.readUInt32BE(16), image.readUInt32BE(20), asset);
  }
});

test('README의 콘셉트 배너와 실제 폰 화면 네 장은 저장소 PNG를 가리킨다', () => {
  const readme = readFileSync(join(repo, 'README.md'), 'utf8');
  const assets = [
    'docs/assets/readme/hero.png',
    ...['role', 'explore', 'collection', 'recommendations']
      .map((name) => `docs/evidence/ui-mascot-2026-09-27/${name}.png`),
  ];
  for (const asset of assets) {
    assert.ok(readme.includes(`src="${asset}"`), asset);
    const image = readFileSync(join(repo, asset));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', asset);
    assert.ok(image.readUInt32BE(16) >= 1080 && image.readUInt32BE(20) >= 700, asset);
  }
  assert.ok(readme.includes('배너는 콘셉트 일러스트입니다'));
  assert.ok(readme.includes('기획 목업이 아닙니다'));
});

function withImageFixture(alt, check) {
  withFixture((root) => {
    const target = join(root, 'index.html');
    writeFileSync(join(root, 'assets/mascot-stamp.png'), readFileSync(join(source, 'assets/mascot-stamp.png')));
    writeFileSync(target, readFileSync(target, 'utf8')
      .replace("style-src 'self';", "style-src 'self'; img-src 'self';")
      .replace('</main>', `<img src="assets/mascot-stamp.png" alt="${alt}"></main>`));
    check(root);
  });
}

test('시연 웹 폴더의 PNG는 img-src self CSP와 대체 글자가 있으면 통과한다', () => {
  withImageFixture('', (root) => assert.equal(run(root).status, 0));
});

test('이미지 대체 글자에도 가짜 발행 문구를 넣을 수 없다', () => {
  withImageFixture('발행 완료', (root) => {
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /금지 문구/);
  });
});

test('없는 이미지 파일은 거부한다', () => {
  withImageFixture('', (root) => {
    rmSync(join(root, 'assets/mascot-stamp.png'));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /이미지 파일 없음/);
  });
});

for (const [name, oldText, replacement, expectedError, file = 'index.html'] of [
  ['공공데이터 가게 고지 제거', '실제 가게 정보로 만든 시연 · 참여하지 않은 가게', '방문할 수 있습니다', '필수 문구 없음'],
  ['가짜 NFT 상태 추가', '</main>', '<p>FINALIZED</p></main>', '금지 문구'],
  ['가짜 발행 완료 추가', '</main>', '<p>발행 완료</p></main>', '금지 문구'],
  ['가짜 거래 해시 추가', '</main>', `<p>0x${'a'.repeat(40)}</p></main>`, '금지 문구'],
  ['쓰기 버튼 삽입', '</main>', '<button>방문 수령</button></main>', '허용되지 않은 태그'],
  ['쓰기 양식 삽입', '</main>', '<form action="/claim"></form></main>', '허용되지 않은 태그'],
  ['원격 스크립트 삽입', '</main>', '<script src="https://example.com/x.js"></script></main>', '허용되지 않은 태그'],
  ['이벤트 핸들러 삽입', '<main id="main">', '<main id="main" onclick="navigator.sendBeacon(\'/claim\')">', '허용되지 않은 속성'],
  ['실행 URL 삽입', '</main>', '<a href="javascript:alert(1)">보기</a></main>', '허용되지 않은 URL'],
  ['숨긴 고지', '실제 가게 정보로 만든 시연 · 참여하지 않은 가게', '<span hidden>실제 가게 정보로 만든 시연 · 참여하지 않은 가게</span>', '허용되지 않은 속성'],
  ['주석 고지', '실제 가게 정보로 만든 시연 · 참여하지 않은 가게', '<!-- 실제 가게 정보로 만든 시연 · 참여하지 않은 가게 -->', '필수 문구 없음'],
  ['외부 CSS 참조', '</main>', '</main>\n<link rel="stylesheet" href="https://example.com/x.css">', '허용되지 않은 URL'],
  ['외부 이미지 삽입', '</main>', '<img src="https://example.com/x.png" alt=""></main>', '허용되지 않은 URL'],
  ['상위 경로 이미지 삽입', '</main>', '<img src="../x.png" alt=""></main>', '허용되지 않은 URL'],
  ['대체 글자 없는 이미지', '</main>', '<img src="assets/mascot-stamp.png"></main>', '이미지 대체 글자 없음'],
  ['CSP 없이 이미지 삽입', '</main>', '<img src="assets/mascot-stamp.png" alt=""></main>', 'img-src'],
  ['외부 아이콘 참조', '</head>', '<link rel="icon" href="https://example.com/x.png"></head>', '허용되지 않은 URL'],
  ['느슨한 이미지 CSP', "form-action 'none'\">", "img-src *; form-action 'none'\">", '허용되지 않은 meta'],
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
