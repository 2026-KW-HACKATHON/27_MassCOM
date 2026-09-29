import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeRecommendationsStyles } from './styles';

test('makeRecommendationsStyles gives rendered light and dark content and states their palette colors', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeRecommendationsStyles(palette);
    assert.equal(styles.centeredTitle.color, palette.label);
    assert.equal(styles.centeredBody.color, palette.secondaryLabel);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.rotationNote.color, palette.secondaryLabel);
    assert.equal(styles.retryButton.backgroundColor, palette.primary);
    assert.equal(styles.inlineError.backgroundColor, palette.errorContainer);
    assert.equal(styles.inlineError.color, palette.onErrorContainer);
  }
});

test('the sky page shows through the recommendations and their text stays readable on it', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeRecommendationsStyles(palette);
    assert.equal('backgroundColor' in styles.content, false);
    assert.equal('backgroundColor' in styles.centered, false);
    // Text sits directly on the page below the art, which is plain sky[2].
    for (const text of [styles.title, styles.body, styles.centeredTitle, styles.centeredBody, styles.rotationNote]) {
      assert.ok(contrast(text.color as string, world.sky[2]) >= 4.5, `${text.color} on ${world.sky[2]}`);
    }
    assert.ok(contrast(styles.eyebrow.color as string, world.sky[2]) >= 4.5, 'eyebrow on the page');
  }
});

test('recommendation cards are FloatingCards on world.card, so their text is judged there', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeRecommendationsStyles(palette);
    // Surface, radius, padding and shadow come from FloatingCard; these styles only lay out the card's contents.
    for (const card of [styles.card, styles.emptyCard]) {
      assert.equal('backgroundColor' in card, false);
      assert.equal('borderRadius' in card, false);
    }
    for (const text of [styles.cardTitle, styles.reason, styles.meta, styles.progress, styles.goal, styles.openDetail, styles.emptyTitle, styles.emptyBody]) {
      assert.ok(contrast(text.color as string, world.card) >= 4.5, `${text.color} on ${world.card}`);
    }
  }
  const source = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /<FloatingCard[\s\S]*?onPress=\{\(\) => router\.push\(/);
  assert.doesNotMatch(source, /<Pressable[^>]*style=\{\(\{ pressed \}\)/, 'a Link child with a function style lost its card');
});
