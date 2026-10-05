import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { darkMedalColors, lightMedalColors } from '../theme/medal-colors';
import { darkColors, lightColors } from '../theme/palette';
import { uiMetrics } from '../theme/ui-metrics';
import { makeGamificationStyles } from './styles';

test('passport styles follow the active palette and keep 48dp actions', () => {
  for (const [palette, medal] of [[lightColors, lightMedalColors], [darkColors, darkMedalColors]] as const) {
    const styles = makeGamificationStyles(palette, medal);
    assert.equal(styles.button.backgroundColor, palette.primary);
    assert.equal(styles.buttonText.color, palette.onPrimary);
    assert.equal(styles.sheet.backgroundColor, palette.background);
    assert.equal(styles.medalCard.backgroundColor, palette.surface);
    assert.equal(styles.passportRank.color, medal.skyInk);
    assert.equal(styles.inkStampText.color, medal.stampInk);
    for (const key of ['button', 'secondaryButton', 'ghostButton', 'boxButton'] as const) {
      assert.equal(styles[key].minHeight, uiMetrics.minTouch, key);
    }
    assert.equal(styles.closeButton.width, uiMetrics.minTouch);
    assert.equal(styles.closeButton.height, uiMetrics.minTouch);
  }
});

test('bold reward box names use the simple Android line breaker so the second word is not clipped', () => {
  // On a Samsung 411dp phone "두 번째 상자" rendered as "두 번째": the 800-weight text is measured narrower than it draws.
  const source = readFileSync(fileURLToPath(new URL('./reward-box.tsx', import.meta.url)), 'utf8');
  assert.match(source, /<Text textBreakStrategy="simple" style=\{styles\.boxName\}>\s*\{rewardBoxName\(reward\.milestone\)\}\s*<Text style=\{styles\.boxRequirement\}>/);
  assert.doesNotMatch(source, /styles\.boxRowTitleLine/);
});

test('쿠폰과 방문 축하 내용은 짧으면 가운데, 길면 스크롤 높이만큼 늘어난다', () => {
  const styles = makeGamificationStyles(lightColors, lightMedalColors);
  for (const key of ['revealCenter', 'celebrationScroll'] as const) {
    const content: { flex?: number; flexGrow?: number; justifyContent?: string } = styles[key];
    assert.equal(content.flexGrow, 1, key);
    assert.equal(content.flex, undefined, key);
    assert.equal(content.justifyContent, 'center', key);
  }
  const source = readFileSync(new URL('./reward-reveal.tsx', import.meta.url), 'utf8');
  assert.match(source, /contentContainerStyle=\{\[styles\.revealCenter/);
});

test('방문 축하의 주요 행동은 요약 다음, 보상 상세 목록보다 먼저 나온다', () => {
  const source = readFileSync(new URL('./celebration.tsx', import.meta.url), 'utf8');
  const summary = source.indexOf('{celebrationNote(content)}');
  const primary = source.indexOf('onPress={onPrimaryAction}');
  const details = source.indexOf('{shownBeat >= 2 ? (');
  assert.ok(summary >= 0 && summary < primary && primary < details);
  assert.equal(source.match(/onPress=\{onPrimaryAction\}/g)?.length, 1);
});

test('줄 바뀌는 축하 링크에는 홀로 남을 구분점이 없다', () => {
  const source = readFileSync(new URL('./celebration.tsx', import.meta.url), 'utf8');
  const links = source.slice(source.indexOf('accessibilityLabel="도감 보기"'), source.indexOf('{featured ? ('));
  assert.doesNotMatch(links, />·<\/Text>/);
  assert.match(links, /onOpenGacha \?/);
  assert.match(links, /onOpenFeedback \?/);
});
