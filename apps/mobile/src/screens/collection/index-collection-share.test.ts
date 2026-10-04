import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { lightWorld } from '../../theme/world';
import { makeCollectionStyles } from './styles';

// 이 저장소에는 RN 렌더러가 없어(.tsx는 node:test로 불러올 수 없다) 도감 화면의 #332 배선은 소스 본문으로 확인한다.
const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
const share = readFileSync(new URL('./collection-share.tsx', import.meta.url), 'utf8');

test('도감 요약 이미지 버튼은 수집품이 있을 때 라벨과 충분한 터치 영역을 제공한다', () => {
  const button = screen.slice(screen.indexOf('{collection.collectibles.length > 0 ? ('), screen.indexOf('<CollectibleBrowser'));
  assert.match(button, /accessibilityRole="button"/);
  assert.match(button, /accessibilityLabel="도감 이미지"/);
  assert.match(button, /accessibilityHint="[^"]+"/);
  assert.match(button, /disabled=\{sharingCollection \|\| sharing\}/);
  assert.match(button, /\{sharingCollection \? '카드 만드는 중…' : '도감 이미지'\}/);
  // 삼항의 거짓 가지는 null이다: 수집품이 없으면 버튼 자체가 없다.
  assert.match(button, /\) : null\}/);
  assert.ok((makeCollectionStyles(lightColors, lightWorld).primaryButton.minHeight as number) >= uiMetrics.minTouch);
});

test('버튼은 도감 응답에서 만든 카드 모델을 공유 훅에 넘기고, 시연 앱 여부(variant)를 함께 넘긴다', () => {
  const handler = screen.slice(screen.indexOf('async function shareCollectionCard'), screen.indexOf('async function refreshBinding'));
  assert.match(handler, /buildCollectionShareCard\(\{ visits: collection\.visits, collectibles: collection\.collectibles, medals: badges\.book\?\.medals \?\? \[\] \}, shareVariant\)/);
  assert.match(handler, /credential\.kind === 'demo'/);
  assert.match(handler, /collectionShareNotice\(await shareCollection\(card\)\)/);
  assert.match(handler, /if \(notice\) setShareNotice\(notice\);/);
  // 만드는 중에는 두 번째 탭을 막는다.
  assert.match(handler, /if \(!collection \|\| sharingCollection\) return;/);
});

test('공유 불가·실패 안내는 버튼 바로 아래에 보이고, 오프스크린 카드는 화면 안에 놓는다', () => {
  assert.match(screen, /\{shareNotice \? <Text accessibilityLiveRegion="polite" style=\{styles\.inlineMessage\}>\{shareNotice\}<\/Text> : null\}/);
  assert.match(screen, /\{collectionShareHost\}/);
  // 수집품 한 장 공유와 도감 공유는 서로의 버튼을 잠근다(시트가 겹쳐 열리지 않게).
  assert.match(screen, /sharing=\{sharing \|\| sharingCollection\}/);
});

test('도감은 1080×1350 이미지 저장과 공유를 지원하고 화면이 사라지면 멈춘다', () => {
  assert.match(share, /captureViewAsPng\(card\.current, \{ \.\.\.collectionShareCaptureSize, fileName: 'masscom-collection' \}\)/);
  assert.match(share, /exportImageFile\(uri, 'masscom-collection', '도감 공유', isAlive\)/);
  assert.match(share, /isAlive: \(\) => alive\.current/);
  assert.match(share, /useEffect\(\(\) => \{\s*alive\.current = true;\s*return \(\) => \{ alive\.current = false; \};/);
  // 자동 게시나 텍스트 폴백은 없다: 시트를 못 열면 한국어 안내만 낸다.
  assert.doesNotMatch(share, /Share\.share/);
  // 화면이 사라진 뒤에는 상태를 건드리지 않는다.
  assert.match(share, /if \(alive\.current\) \{\s*setModel\(undefined\);\s*setSharing\(false\);\s*\}/);
});

test('오프스크린 카드는 스크린리더에서 숨기고, 터치를 받지 않으며, 글꼴 배율을 따르지 않는다', () => {
  assert.match(share, /pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/);
  assert.equal((share.match(/<Text /g) ?? []).length, (share.match(/<Text allowFontScaling=\{false\}/g) ?? []).length);
});

test('카드에는 계정·날짜·지갑·QR 자리가 없다: 모델의 제목·부제·푸터·등급 틀·메달 줄·가상 기록 표시만 그린다', () => {
  for (const field of ['model.title', 'model.subtitle', 'model.footer', 'model.medals', 'model.demoNote', 'model.items']) {
    assert.ok(share.includes(field), field);
  }
  assert.doesNotMatch(share, /accountId|email|nickname|earnedAt|businessDate|recipient|contractAddress|<ClaimQr|friendCode/);
});

test('카드 컴포넌트는 시각을 읽거나 날짜 형식을 만들지 않는다(그리는 시각이 이미지에 찍히지 않게)', () => {
  assert.doesNotMatch(share, /new Date|Date\.now|toISOString|toLocale|Intl\./);
});

test('카드의 모든 <Text> 내용은 model·item·medal의 값이거나 상수뿐이다: 화면에서 새로 만든 문구가 끼어들지 않는다', () => {
  const texts = [...share.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map((match) => match[1]!.trim());
  assert.ok(texts.length >= 6, `found ${texts.length} Text nodes`);
  for (const child of texts) {
    assert.match(child, /^\{(?:model|item|medal)\.[A-Za-z]+\}$|^\{[A-Z][A-Za-z]*\}$/, `unexpected <Text> child: ${child}`);
  }
  // 그림의 출처도 모델의 imageUri 하나뿐이다.
  const sources = [...share.matchAll(/uri: ([^ }]+)/g)].map((match) => match[1]);
  assert.deepEqual(sources, ['item.imageUri']);
});

test('웹도 실제 이미지 촬영과 파일 내보내기를 사용한다', () => {
  assert.match(share, /exportImageFile/);
  assert.doesNotMatch(share, /captureUnsupported: Platform\.OS === 'web'/);
});
