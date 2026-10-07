import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ownedPage, ownedPageSize } from './owned-page';

test('누적 소장품은 한 페이지 분량만 렌더링하고 마지막 페이지까지 선택할 수 있다', () => {
  const items = Array.from({ length: 1000 }, (_, id) => ({ id }));
  const seen: number[] = [];
  for (let page = 0; page < Math.ceil(items.length / ownedPageSize); page++) {
    const result = ownedPage(items, page);
    assert.ok(result.items.length <= 24);
    assert.equal(result.hasPrevious, page > 0);
    assert.equal(result.hasNext, (page + 1) * ownedPageSize < items.length);
    seen.push(...result.items.map((item) => item.id));
  }
  assert.deepEqual(seen, items.map((item) => item.id));
  assert.deepEqual(items[999], { id: 999 });
});

test('빈 목록·줄어든 목록·요청된 수집품은 유효한 페이지를 사용한다', () => {
  assert.deepEqual(ownedPage([], 12), { items: [], page: 0, totalPages: 1, hasPrevious: false, hasNext: false });
  assert.equal(ownedPage([1, 2], 99).page, 0);
  assert.equal(ownedPage([1, 2], -1).page, 0);
  const items = Array.from({ length: 50 }, (_, id) => id);
  assert.ok(ownedPage(items, Math.floor(49 / ownedPageSize)).items.includes(49));
});

test('선택 화면은 페이지 항목만 표시하고 확대 글자의 이름을 자르지 않는다', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../screens/studio/index.tsx', import.meta.url), 'utf8');
  assert.match(source, /page\.items\.map\(/);
  assert.doesNotMatch(source, /owned\.map\(/);
  assert.match(source, /<Text style=\{\[styles\.rowTitle, \{ color: palette\.label \}\]\}>\{item\.displayName\}<\/Text>/);
  assert.match(source, /<Text style=\{\[styles\.rowMeta, \{ color: palette\.secondaryLabel \}\]\}>\{item\.merchantName\}<\/Text>/);
  assert.match(source, /accessibilityRole="button" accessibilityState={{ disabled: !page\.hasNext }}/);
  assert.match(source, /setCollectionPage\(page\.page \+ 1\)/);
  assert.match(source, /setCollectionPage\(page\.page - 1\)/);
});
