import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeWalletLinkStyles } from './styles';

test('makeWalletLinkStyles gives rendered light and dark content and states their palette colors', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeWalletLinkStyles(palette);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.body.color, palette.secondaryLabel);
    assert.equal(styles.statusLabel.color, palette.secondaryLabel);
    assert.equal(styles.statusValue.color, palette.label);
    assert.equal(styles.message.backgroundColor, palette.primaryContainer);
    assert.equal(styles.messageError.backgroundColor, palette.errorContainer);
    assert.equal(styles.boundaryTitle.color, palette.label);
  }
});

test('the sky page shows through the wallet screen and the status and boundary cards are FloatingCards', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeWalletLinkStyles(palette);
    assert.equal('backgroundColor' in styles.content, false);
    // Surface, radius, padding and shadow come from FloatingCard; these styles only lay out the card's contents.
    for (const card of [styles.card, styles.boundaryCard]) {
      assert.equal('backgroundColor' in card, false);
      assert.equal('borderRadius' in card, false);
    }
  }
});

test('wallet text stays legible on the sky page, on the cards and on the message containers', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeWalletLinkStyles(palette);
    for (const surface of [world.page, world.sky[2]]) {
      for (const text of [styles.context, styles.title, styles.body]) {
        assert.ok(contrast(text.color, surface) >= 4.5, `${text.color} on ${surface}`);
      }
    }
    for (const text of [styles.statusLabel, styles.statusValue, styles.address, styles.boundaryTitle, styles.boundaryText]) {
      assert.ok(contrast(text.color, world.card) >= 4.5, `${text.color} on ${world.card}`);
    }
    for (const [foreground, background] of [
      [styles.messageText.color, styles.message.backgroundColor],
      [styles.messageText.color, styles.messageError.backgroundColor],
    ]) {
      assert.ok(contrast(foreground, background) >= 4.5, `${foreground} over ${background}`);
    }
  }
});

test('the wallet screens carry their own sky back header because the stack header is hidden', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  for (const file of ['./index.tsx', './configuration-required.tsx']) {
    const source = read(file);
    assert.match(source, /<SkyBackdrop>/, file);
    assert.match(source, /header=\{<BackHeader title="외부 지갑 연결" \/>\}/, file);
    assert.doesNotMatch(source, /<ScrollView/, `${file} must scroll inside SkyScrollView`);
  }
  assert.match(read('./index.tsx'), /<FloatingCard style=\{styles\.card\}>/);
  assert.match(read('../../app/wallet.tsx'), /<AuthRequiredRoute header=\{<BackHeader title="외부 지갑 연결" \/>\} \/>/);
  assert.match(read('../../app/_layout.tsx'), /<Stack\.Screen name="wallet" options=\{\{ headerShown: false \}\} \/>/);
});
