import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mascotAccessibility } from './mascot-a11y';

test('a labelled mascot is an image that screen readers announce', () => {
  assert.deepEqual(mascotAccessibility('지도를 든 마스코트'), {
    accessible: true, accessibilityRole: 'image', accessibilityLabel: '지도를 든 마스코트',
  });
});

test('a decorative mascot is hidden from every screen reader', () => {
  assert.deepEqual(mascotAccessibility(undefined), {
    accessible: false, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true,
  });
  assert.deepEqual(mascotAccessibility(''), mascotAccessibility(undefined), 'an empty label is no label');
});
