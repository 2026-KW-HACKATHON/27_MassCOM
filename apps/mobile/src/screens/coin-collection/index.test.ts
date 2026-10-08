import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const screen = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');

test('missing coin guidance links the catalog merchant by id without promising a grade', () => {
  assert.match(screen, /grade\.quantity === 0[\s\S]*?획득 정보: 가게 상세·뽑기권에서 확인/);
  assert.match(screen, /merchantId: merchant\.merchantId, from: 'collection'/);
  assert.match(screen, /뽑기권 판매 여부 확인/);
});

test('owned coin store identity is matched by publication and grade, and series progress counts owned slots', () => {
  assert.match(screen, /type\.publicationId === coin\.publicationId[\s\S]*?grade\.gradeId === coin\.gradeId/);
  assert.match(screen, /slot\.quantity > 0\)\.length/);
  assert.match(screen, /merchantId: series\.merchantId, from: 'collection'/);
});
