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
