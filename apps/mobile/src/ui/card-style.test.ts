import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitCardStyle } from './card-style';

test('layout props go to the outer wrapper and visual props stay on the card', () => {
  const { outer, inner } = splitCardStyle({
    margin: 4, marginTop: 2, marginHorizontal: 6, flex: 1, flexGrow: 2, flexShrink: 0, flexBasis: 10,
    width: 100, minWidth: 50, maxWidth: 300, alignSelf: 'flex-start', position: 'absolute', top: 1, left: 2, right: 3, bottom: 4, zIndex: 5,
    flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 4, minHeight: 96, borderRadius: 3, backgroundColor: 'red', alignItems: 'center',
  });
  assert.deepEqual(Object.keys(outer).sort(), [
    'alignSelf', 'bottom', 'flex', 'flexBasis', 'flexGrow', 'flexShrink', 'left', 'margin', 'marginHorizontal', 'marginTop',
    'maxWidth', 'minWidth', 'position', 'right', 'top', 'width', 'zIndex',
  ]);
  // flexDirection/flexWrap arrange the card's own children, so they belong to the card.
  assert.deepEqual(Object.keys(inner).sort(), [
    'alignItems', 'backgroundColor', 'borderRadius', 'flexDirection', 'flexWrap', 'gap', 'minHeight', 'padding',
  ]);
});

test('no style is lost or duplicated, and an absent style splits into two empty ones', () => {
  const style = { marginBottom: 8, padding: 4, flex: 1, borderWidth: 2 } as const;
  const { outer, inner } = splitCardStyle(style);
  assert.deepEqual({ ...outer, ...inner }, style);
  assert.equal(Object.keys(outer).length + Object.keys(inner).length, Object.keys(style).length);
  assert.deepEqual(splitCardStyle(undefined), { outer: {}, inner: {} });
});
