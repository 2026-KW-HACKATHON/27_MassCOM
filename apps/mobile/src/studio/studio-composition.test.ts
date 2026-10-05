import assert from 'node:assert/strict';
import test from 'node:test';
import { studioComposition, studioDecorPlacement } from './studio-composition';

test('real decor roles keep hanging objects on the wall and furniture off it', () => {
  for (const id of ['explorer-gold-decor', 'regular-gold-decor', 'gold-decor']) assert.equal(studioDecorPlacement(id).surface, 'wall');
  for (const id of ['steady-gold-decor', 'silver-decor', 'order-sign']) assert.equal(studioDecorPlacement(id).surface, 'floor');
  assert.equal(studioDecorPlacement('bronze-decor').surface, 'table');
});

test('standing objects contact the foreground floor; the tray contacts the left bench without hiding the actor', () => {
  const floor = studioDecorPlacement('steady-gold-decor');
  assert.ok(floor.anchorY > .9 && floor.anchorY < 1);
  assert.equal(floor.paintedBase, 1);
  assert.ok(floor.left + floor.size < studioComposition.avatarLeft);
  const tray = studioDecorPlacement('bronze-decor');
  assert.ok(tray.anchorY > .65 && tray.anchorY < .75);
  assert.ok(tray.paintedBase > .9 && tray.paintedBase < 1, 'painted tray base excludes transparent atlas padding');
  assert.ok(tray.left + tray.size < studioComposition.avatarLeft);
  const map = studioDecorPlacement('explorer-gold-decor');
  assert.deepEqual(map, { surface: 'wall', left: .76, anchorY: .16, size: .15, paintedBase: 0 });
});
