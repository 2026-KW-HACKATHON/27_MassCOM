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
