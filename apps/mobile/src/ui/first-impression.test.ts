import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('single web export는 한국어 HTML과 어절 줄바꿈을 사용한다 (#401 V-20)', () => {
  const config = JSON.parse(source('../../app.json'));
  assert.equal(config.expo.web.output, 'single');
  assert.equal(config.expo.web.lang, 'ko');
  assert.match(source('../app/_layout.tsx'), /import ['"]\.\/global\.css['"]/);
  assert.match(source('../app/global.css'), /word-break:\s*keep-all\s*!important/);
});

test('점주 오류는 테마 헤더·마스코트와 실제 버튼 세 개를 제공한다 (#401 V-13)', () => {
  const screen = source('../screens/showcase-merchant/index.tsx');
  assert.match(screen, /<SkyScrollView[\s\S]*?<BackHeader title="점주 체험"/);
  assert.match(screen, /<Mascot pose="puzzled"/);
  for (const label of ['다시 시도', '역할 선택으로', '고객으로 둘러보기']) {
    assert.match(screen, new RegExp(`<BounceButton label="${label}"`));
  }
  assert.match(screen, /점포 정보를 확인하지 못했어요/);
});

test('공용 버튼은 전달한 문구를 접근성 이름으로 사용한다 (#401)', () => {
  assert.match(source('./bounce-button.tsx'), /accessibilityLabel=\{label\}/);
});
