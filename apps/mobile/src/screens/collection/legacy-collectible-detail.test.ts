import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { legacyCollectibleDetail } from './legacy-collectible-detail';
import type { UngroupedCollectible } from './collectible-groups';

const item: UngroupedCollectible = {
  entitlementId: 'legacy-1', merchantId: 'store-1', merchantName: '월계 식당',
  displayName: '단골 수집품', campaignTitle: '가게 방문', targetVisitCount: 3,
  earnedAt: '2026-10-03T00:00:00Z', nftStatus: 'NOT_REQUESTED', nft: null, recipient: null,
};

test('기존 수집품과 가게 그림을 로컬 회전 상세에 전달하며 기본 뒷면을 사용한다', () => {
  const source = { uri: 'https://example.com/store.png' };
  const detail = legacyCollectibleDetail(item, source);
  assert.equal(detail.name, item.displayName);
  assert.equal(detail.merchantName, item.merchantName);
  assert.equal(detail.gradeId, 'silver');
  assert.equal(detail.gradeName, '실버');
  assert.deepEqual(detail.frontImageSource, source);
  assert.equal(detail.shape, 'stamp');
  assert.equal(detail.angle, 0);
  assert.ok(detail.thickness > 0);
  assert.equal(Object.hasOwn(detail, 'backImageDataUrl'), false);
  assert.equal(Object.hasOwn(detail, 'publicationId'), false);
});

test('1·3·5회 목표의 등급과 그림 없는 마스코트 앞면을 지원한다', () => {
  for (const [targetVisitCount, gradeId, gradeName] of [[1, 'bronze', '브론즈'], [3, 'silver', '실버'], [5, 'gold', '골드']] as const) {
    const detail = legacyCollectibleDetail({ ...item, targetVisitCount, displayName: '' });
    assert.equal(detail.gradeId, gradeId);
    assert.equal(detail.gradeName, gradeName);
    assert.equal(detail.name, item.campaignTitle);
    assert.equal(detail.frontImageSource, undefined);
    assert.equal(detail.backImageDataUrl, undefined);
  }
  assert.equal(legacyCollectibleDetail(item, 42).frontImageSource, 42);
});

test('LegacyCard 버튼이 로컬 입력으로 동일한 회전 상세를 연다', () => {
  const browser = readFileSync(new URL('./collectible-browser.tsx', import.meta.url), 'utf8');
  assert.match(browser, /<LegacyCard\b[^>]*onOpenDetail=\{onOpenDetail\}/);
  const card = browser.slice(browser.indexOf('function LegacyCard'), browser.indexOf('const styles ='));
  assert.match(card, /onPress=\{\(\) => onOpenDetail\(item\.entitlementId, item\.merchantName, legacyCollectibleDetail\(item, source\)\)\}/);
  assert.match(card, /accessibilityLabel=\{[^\n]*상세 보기/);
  const floating = readFileSync(new URL('../../ui/floating-card.tsx', import.meta.url), 'utf8');
  assert.match(floating, /accessibilityRole="button"/);
  const index = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(index, /localDetail=\{collectibleDetail\.localDetail\}/);
  const detail = readFileSync(new URL('./collectible-detail.tsx', import.meta.url), 'utf8');
  assert.match(detail, /if \(localDetail\) return;/);
  assert.match(detail, /snapshot\.frontImageSource/);
  assert.match(detail, /<Mascot pose="stamp"/);
});
