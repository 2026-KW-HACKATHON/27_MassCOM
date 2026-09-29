import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mascotAccessibility } from './mascot-a11y';

test('a labelled mascot is an image that screen readers announce', () => {
  assert.deepEqual(mascotAccessibility('지도를 든 마스코트'), {
    accessible: true, accessibilityRole: 'image', accessibilityLabel: '지도를 든 마스코트',
  });
});

test('a labelled mascot you can tap is a button that says what tapping does', () => {
  assert.deepEqual(mascotAccessibility('손을 흔드는 마스코트', true), {
    accessible: true, accessibilityRole: 'button', accessibilityLabel: '손을 흔드는 마스코트', accessibilityHint: '눌러서 흔들기',
  });
  assert.deepEqual(mascotAccessibility('지도를 든 마스코트', false), mascotAccessibility('지도를 든 마스코트'));
});

test('a decorative mascot is hidden from every screen reader, tappable or not', () => {
  assert.deepEqual(mascotAccessibility(undefined), {
    accessible: false, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true,
  });
  assert.deepEqual(mascotAccessibility(''), mascotAccessibility(undefined), 'an empty label is no label');
  assert.deepEqual(mascotAccessibility(undefined, true), mascotAccessibility(undefined), 'a decorative hero adds no focus stop');
});
