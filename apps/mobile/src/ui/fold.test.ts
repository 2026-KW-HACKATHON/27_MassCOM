import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Fold renders react-native views, so it cannot go through the node:test/esbuild runner (see HANDOFF for the
// react-native Flow-syntax crash); these are light source checks on its own file instead, same as index.test.ts.
const source = readFileSync(new URL('./fold.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('Fold can be controlled by a caller (expanded/onToggle) instead of only its own internal toggle (#296 review)', () => {
  // Without this, a caller (e.g. a `focus=` deep link) has no way to force a collapsed fold open itself.
  assert.match(source, /expanded\?:\s*boolean;/);
  assert.match(source, /onToggle\?:\s*\(\) => void;/);
  assert.match(source, /const expanded = expandedProp \?\? internalExpanded;/);
  assert.match(source, /const toggle = onToggle \?\? \(\(\) => setInternalExpanded\(\(value\) => !value\)\);/);
  assert.match(source, /onPress=\{toggle\}/);
});

test('Fold reports its own root position via onLayout, not something inside its collapsible body (#296 review)', () => {
  // Collapsing only unmounts the body below; the root View (ahead of FloatingCard) never moves, so measuring it
  // must happen on that outer View, not on anything inside `{expanded ? <View>{children}</View> : null}`.
  const outerView = source.slice(source.indexOf('return (\n'), source.indexOf('<FloatingCard'));
  assert.match(outerView, /onLayout=\{onLayout \? \(event: LayoutChangeEvent\) => onLayout\(event\.nativeEvent\.layout\.y\) : undefined\}/);
});

test('Fold announces expanded state to assistive tech via accessibilityState, not only the label text', () => {
  assert.match(source, /accessibilityState=\{\{ expanded \}\}/);
});
