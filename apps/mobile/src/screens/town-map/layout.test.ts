import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PIN_TOUCH, mapHeightFor, pinCenter, revealScrollY } from './layout';

test('the map is as tall as the portrait art is at the width it is drawn', () => {
  assert.equal(mapHeightFor(300), 450);
  assert.equal(mapHeightFor(371), 556.5);
});

test('a pin is centred on its anchor as a fraction of the drawn map', () => {
  assert.deepEqual(pinCenter({ x: 0.5, y: 0.25 }, 400), { x: 200, y: 150 });
  assert.equal(PIN_TOUCH, 48);
});

const view = { viewportHeight: 800, coverHeight: 300, topInset: 30 };

test('a pin that is already clear of the status bar and the sheet does not move the page', () => {
  assert.equal(revealScrollY({ ...view, pinY: 400, scrollY: 0 }), null);
  assert.equal(revealScrollY({ ...view, pinY: 900, scrollY: 500 }), null);
});

test('a pin the sheet would cover scrolls up into the free band', () => {
  const target = revealScrollY({ ...view, pinY: 700, scrollY: 0 });
  assert.ok(target !== null && target > 0);
  const onScreen = 700 - target;
  assert.ok(onScreen >= view.topInset + 24 && onScreen <= view.viewportHeight - view.coverHeight - 24, `pin lands at ${onScreen}`);
});

test('a pin scrolled off the top comes back down, and the page never scrolls above its start', () => {
  const target = revealScrollY({ ...view, pinY: 100, scrollY: 400 });
  assert.ok(target !== null && target >= 0 && target < 400);
  assert.equal(revealScrollY({ ...view, pinY: 20, scrollY: 300 }), 0);
});

test('a sheet taller than the free space still brings the pin to the top of what is left', () => {
  const target = revealScrollY({ viewportHeight: 600, coverHeight: 560, topInset: 30, pinY: 900, scrollY: 0 });
  assert.equal(target, 900 - (30 + 24 + 8));
});

test('the sheet height that was measured decides how far a pin is lifted: a taller sheet lifts it higher', () => {
  const base = { viewportHeight: 800, topInset: 30, pinY: 700, scrollY: 0 };
  const short = revealScrollY({ ...base, coverHeight: 200 });
  const tall = revealScrollY({ ...base, coverHeight: 400 });
  assert.ok(short !== null && tall !== null && tall > short, `tall ${tall} vs short ${short}`);
  // The pin ends up inside the free band above the measured sheet, not under it.
  assert.ok(700 - tall! <= 800 - 400 - 24);
});

test('the target never goes past the end of the padded content, whatever the pin asks for', () => {
  const view = { viewportHeight: 800, coverHeight: 300, topInset: 30, pinY: 1200, scrollY: 0 };
  // Unclamped, the pin would be aimed at 1200 - 265 = 935; content 1300 tall only scrolls to 1300 - 800 = 500.
  assert.ok((revealScrollY(view) ?? 0) > 500);
  assert.equal(revealScrollY({ ...view, contentHeight: 1300 }), 500);
  // More padding (a taller sheet) makes the content taller, and the same pin can then be lifted further.
  assert.equal(revealScrollY({ ...view, contentHeight: 1900 }), revealScrollY(view));
  // Content shorter than the screen cannot scroll at all.
  assert.equal(revealScrollY({ ...view, contentHeight: 700 }), 0);
});

test('an unknown content height leaves the clamp to the native scroll view', () => {
  const view = { viewportHeight: 800, coverHeight: 300, topInset: 30, pinY: 1200, scrollY: 0 };
  assert.equal(revealScrollY({ ...view, contentHeight: undefined }), revealScrollY(view));
});
