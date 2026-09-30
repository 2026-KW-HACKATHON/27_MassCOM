import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { CollectionSnapshot } from '../../commerce/commerce-api';
import { collectibleFocusAction } from './collectible-focus';

const item = (entitlementId: string, artwork?: unknown) => ({ entitlementId, ...(artwork ? { artwork } : {}) }) as CollectionSnapshot['collectibles'][number];
const art = { publicationId: 'p', projectId: 'q', gradeId: 'bronze', gradeName: '브론즈', name: '가게 우표', shape: 'stamp', theme: { name: '기본' }, thumbnailDataUrl: 'data:image/png;base64,AAAA' };

test('스냅샷에 있는 보상은 외형이 있으면 열고 없으면 안내한다', () => {
  assert.equal(collectibleFocusAction({ collectibles: [item('a', art)] }, 'a', false), 'open');
  assert.equal(collectibleFocusAction({ collectibles: [item('a')] }, 'a', false), 'message');
});

test('스냅샷이 방금 받은 보상보다 오래됐으면 한 번만 다시 읽고, 그래도 없으면 안내한다', () => {
  const stale = { collectibles: [item('older', art)] };
  assert.equal(collectibleFocusAction(stale, 'fresh', false), 'fetch');
  assert.equal(collectibleFocusAction(stale, 'fresh', true), 'message');
  assert.equal(collectibleFocusAction({ collectibles: [item('older', art), item('fresh', art)] }, 'fresh', true), 'open');
  assert.equal(collectibleFocusAction(stale, undefined, false), 'fetch');
});

test('도감 화면은 없는 권리를 세대 확인을 거치는 조회로 한 번만 다시 읽은 뒤 열거나 안내한다', () => {
  const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  const effect = screen.slice(screen.indexOf('const collectibleLink = useRef'), screen.indexOf('useMerchantCatalog(apiUrl);'));
  assert.match(effect, /collectibleFocusAction\(collection, entitlement, link\.rereadFor === entitlement\) === 'fetch'/);
  assert.match(effect, /link\.rereadFor = entitlement;\s*const generation = startRequest\(\);\s*void api\.getCollection\(\)\.then\(\(next\) => \{ applySnapshot\(next, generation\); finish\(next\); \}, \(\) => finish\(collection\)\);/);
  assert.match(effect, /if \(item\?\.artwork\) setCollectibleDetail/);
  assert.match(effect, /else setMessage\('보상은 도감에 보관됐어요/);
  // 같은 링크를 두 번 처리하지 않고, 링크가 지워지면 상태를 비운다.
  assert.match(effect, /link\.doneFor === entitlement/);
  assert.match(effect, /if \(focus !== 'collectible'\) \{ collectibleLink\.current = \{\}; return; \}/);
});
