import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeAuthRequiredStyles } from './styles';

test('makeAuthRequiredStyles gives rendered light and dark content and states their palette colors', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeAuthRequiredStyles(palette);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.body.color, palette.secondaryLabel);
    assert.equal(styles.statusTitle.color, palette.label);
    assert.equal(styles.eyebrow.color, palette.primary);
  }
});

test('the sky page shows through the sign-in prompt and its text stays readable on the page and on the card', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeAuthRequiredStyles(palette);
    assert.equal('backgroundColor' in styles.content, false);
    // The status card is a FloatingCard, which owns the surface, radius, padding and shadow.
    assert.equal('backgroundColor' in styles.statusCard, false);
    assert.equal('borderRadius' in styles.statusCard, false);
    for (const surface of [world.page, world.sky[2]]) {
      for (const text of [styles.eyebrow, styles.title, styles.body]) {
        assert.ok(contrast(text.color as string, surface) >= 4.5, `${text.color} on ${surface}`);
      }
    }
    assert.ok(contrast(styles.statusTitle.color, world.card) >= 4.5, `${styles.statusTitle.color} on ${world.card}`);
  }
});

test('both the native and web sign-in screens sit on the sky page with a sky header and a FloatingCard status', () => {
  for (const file of ['./index.tsx', './index.web.tsx']) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    assert.match(source, /<SkyBackdrop>/, file);
    assert.match(source, /header=\{header \?\? <SkyBanner \/>\}/, file);
    assert.match(source, /<FloatingCard style=\{styles\.statusCard\}>/, file);
    assert.doesNotMatch(source, /backgroundColor: 'transparent'/, `${file} must not paper over a solid page colour`);
  }
});
