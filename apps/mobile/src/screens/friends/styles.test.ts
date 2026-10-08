import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeFriendsStyles } from './styles';

const schemes = [[lightColors, lightWorld], [darkColors, darkWorld]] as const;

test('the sky shows through the friends screens instead of a flat page colour', () => {
  for (const [palette, world] of schemes) {
    assert.equal('backgroundColor' in makeFriendsStyles(palette, world).content, false);
  }
});

test('section headings on the sky and the text on the cards stay readable in light and dark', () => {
  for (const [palette, world] of schemes) {
    const styles = makeFriendsStyles(palette, world);
    for (const sky of [world.page, ...world.sky]) {
      for (const text of [styles.sectionTitle, styles.sectionNote]) {
        assert.ok(contrast(text.color as string, sky) >= 4.5, `${text.color} on ${sky}`);
      }
    }
    for (const text of [styles.eyebrow, styles.nickname, styles.code, styles.inputLabel, styles.note, styles.rowName, styles.rowMeta, styles.chevron, styles.passportRank]) {
      assert.ok(contrast(text.color as string, world.card) >= 4.5, `${text.color} on card`);
    }
    for (const [text, fill] of [
      [styles.primaryButtonText, styles.primaryButton],
      [styles.rankBadgeText, styles.rankBadge],
      [styles.meChipText, styles.meChip],
      [styles.successMessage, styles.successMessage],
      [styles.errorMessage, styles.errorMessage],
    ] as const) {
      assert.ok(contrast(text.color as string, fill.backgroundColor as string) >= 4.5, `${text.color} on ${fill.backgroundColor}`);
    }
    for (const text of [styles.outlineButtonText, styles.dangerButtonText]) {
      assert.ok(contrast(text.color as string, world.card) >= 4.5, `${text.color} on card`);
    }
  }
});

test('every control is a 48dp target and the outlined ones have a 3:1 edge on the card', () => {
  for (const [palette, world] of schemes) {
    const styles = makeFriendsStyles(palette, world);
    for (const key of ['primaryButton', 'outlineButton', 'dangerButton', 'input', 'rankRow'] as const) {
      assert.ok((styles[key].minHeight as number) >= uiMetrics.minTouch, key);
    }
    for (const key of ['outlineButton', 'dangerButton'] as const) {
      assert.ok(contrast(styles[key].borderColor as string, world.card) >= 3, `${key} edge on the card`);
    }
  }
});

test('the code and nickname inputs have a visible boundary: 1.5dp, at least 3:1 against the card and their own fill (WCAG 1.4.11)', () => {
  for (const [palette, world] of schemes) {
    const styles = makeFriendsStyles(palette, world);
    assert.ok((styles.input.borderWidth as number) >= 1.5, 'border thickness');
    assert.equal(styles.input.borderColor, world.cardMuted);
    assert.ok(contrast(styles.input.borderColor as string, world.card) >= 3, 'border on the card');
    assert.ok(contrast(styles.input.borderColor as string, styles.input.backgroundColor as string) >= 3, 'border on the input fill');
    assert.ok(contrast(styles.input.color as string, styles.input.backgroundColor as string) >= 4.5, 'typed text on the input fill');
  }
  const screen = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');
  assert.doesNotMatch(screen, /borderColor: palette\.separator/);
});

test('my own row is marked by an edge and a 나 chip, not by colour alone', () => {
  for (const [palette, world] of schemes) {
    const styles = makeFriendsStyles(palette, world);
    assert.ok((styles.rankRowMe.borderWidth as number) >= 2);
    assert.ok(contrast(styles.rankRowMe.borderColor as string, world.card) >= 3, 'my row edge on the card');
  }
});

test('친구 오른쪽 그림 버튼 네 개는 48dp 타깃을 유지하고 320px 화면에서 프로필 공간을 남긴다', () => {
  for (const [palette, world] of schemes) {
    const styles = makeFriendsStyles(palette, world);
    assert.ok(styles.friendIconButton.width >= 48);
    assert.ok(styles.friendIconButton.height >= 48);
    assert.equal(styles.friendActionGrid.width, styles.friendIconButton.width * 2 + styles.friendActionGrid.gap);
    assert.ok(contrast(styles.friendIconButton.borderColor, world.card) >= 3);
    for (const viewport of [320, 360]) {
      const remainingProfileWidth = viewport - 2 * styles.content.padding - 2 * styles.friendActionCard.padding
        - styles.friendActionGrid.width - styles.friendActionRow.gap;
      assert.ok(remainingProfileWidth >= 140, `${viewport}px에서 이름과 메달이 들어갈 공간`);
    }
  }
});
