import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spaceToggles } from './space-toggles';

function press(key: string, repeat = false) {
  let prevented = 0;
  let toggled = 0;
  spaceToggles(() => { toggled += 1; })({ key, repeat, preventDefault: () => { prevented += 1; } });
  return { prevented, toggled };
}

test('Space and Spacebar toggle once and keep the page from scrolling', () => {
  assert.deepEqual(press(' '), { prevented: 1, toggled: 1 });
  assert.deepEqual(press('Spacebar'), { prevented: 1, toggled: 1 });
});

test('a held Space is swallowed without toggling again, and other keys are left alone', () => {
  assert.deepEqual(press(' ', true), { prevented: 1, toggled: 0 });
  // Enter already works through react-native-web's own press handling.
  for (const key of ['Enter', 'Tab', 'a', 'ArrowDown']) assert.deepEqual(press(key), { prevented: 0, toggled: 0 }, key);
});

test('shortcut chords and keys bubbled up from a focusable child are not ours: no toggle and no preventDefault', () => {
  const row = {};
  const run = (event: Record<string, unknown>) => {
    let prevented = 0;
    let toggled = 0;
    spaceToggles(() => { toggled += 1; })({ key: ' ', preventDefault: () => { prevented += 1; }, ...event });
    return { prevented, toggled };
  };
  for (const chord of ['ctrlKey', 'altKey', 'metaKey']) assert.deepEqual(run({ [chord]: true }), { prevented: 0, toggled: 0 }, chord);
  // Space typed in or on a focusable child (a link or input inside the row) has target !== currentTarget.
  assert.deepEqual(run({ target: {}, currentTarget: row }), { prevented: 0, toggled: 0 });
  // The row itself focused: target is currentTarget, so it still toggles.
  assert.deepEqual(run({ target: row, currentTarget: row }), { prevented: 1, toggled: 1 });
});
