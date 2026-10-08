import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { collectibleFlameAnchors, collectibleFlameFrame, collectibleFlamePath, effectSpeedValue, effectStrengthValue, FLAME_PERIOD_MS } from './collectible-aura';

test('flame geometry uses fixed native perimeter slots and finite upward tips for all three shapes', () => {
  for (const shape of ['circle', 'stamp', 'serrated']) {
    for (const size of [131.2, 209.92, 295.2]) {
      const anchors = collectibleFlameAnchors(shape, size);
      assert.ok(anchors.length > 20 && anchors.length <= 38, shape);
      assert.equal(new Set(anchors.map(anchor => anchor.slot)).size, anchors.length);
      assert.ok(anchors.every(anchor => anchor.y <= size * .36));
      for (const angle of [-180, -90, 0, 45, 90, 180]) {
        for (const speed of [.25, 1, 3]) {
          const frame = collectibleFlameFrame(shape, size, angle, 350, speed, 100);
          assert.deepEqual(frame.map(tongue => tongue.slot), anchors.map(anchor => anchor.slot));
          for (const tongue of frame) {
            assert.ok([tongue.x, tongue.y, tongue.tipX, tongue.tipY, tongue.width, tongue.alpha].every(Number.isFinite));
            assert.ok(tongue.tipY < tongue.y, `${shape} ${angle} tip rises`);
            assert.ok(tongue.width > 0 && tongue.alpha >= 0 && tongue.alpha <= 1);
            assert.match(collectibleFlamePath(tongue), /^M[^N]*Q[^N]*Q[^N]*Z$/);
          }
        }
      }
    }
  }
});

test('flame speed changes phase without changing anchors and both sides of each loop seam are continuous', () => {
  for (const shape of ['circle', 'stamp', 'serrated']) {
    assert.deepEqual(collectibleFlameFrame(shape, 256, 35, 200, 2, 65), collectibleFlameFrame(shape, 256, 35, 400, 1, 65));
    for (const speed of [.25, 1, 3]) {
      const duration = FLAME_PERIOD_MS / speed;
      const first = collectibleFlameFrame(shape, 256, 35, 0, speed, 65);
      const looped = collectibleFlameFrame(shape, 256, 35, duration, speed, 65);
      assert.deepEqual(looped, first);
      const before = collectibleFlameFrame(shape, 256, 35, duration - .001, speed, 65);
      const after = collectibleFlameFrame(shape, 256, 35, duration + .001, speed, 65);
      for (let index = 0; index < first.length; index++) {
        assert.equal(before[index]!.slot, after[index]!.slot);
        assert.equal(before[index]!.x, after[index]!.x, 'flame base remains fixed');
        assert.equal(before[index]!.y, after[index]!.y);
        assert.ok(Math.hypot(before[index]!.tipX - after[index]!.tipX, before[index]!.tipY - after[index]!.tipY) < .002);
      }
    }
  }
});

test('old missing speed uses one, invalid numeric inputs are bounded, and zero strength creates no flame assets', () => {
  assert.equal(effectSpeedValue({}), 1);
  assert.equal(effectSpeedValue({ speed: NaN }), 1);
  assert.equal(effectSpeedValue({ speed: 0 }), .25);
  assert.equal(effectSpeedValue({ speed: 9 }), 3);
  assert.equal(effectStrengthValue({ strength: NaN }), 45);
  assert.equal(effectStrengthValue({ strength: -1 }), 0);
  assert.equal(effectStrengthValue({ strength: 101 }), 100);
  assert.deepEqual(collectibleFlameFrame('circle', 256, 0, 200, 1, 0), []);
  assert.deepEqual(collectibleFlameFrame('circle', 0), []);
  assert.deepEqual(collectibleFlameFrame('circle', Infinity), []);
  assert.deepEqual(collectibleFlameFrame('circle', 256, NaN, NaN, NaN), collectibleFlameFrame('circle', 256));
});

test('native flame keeps the shared UI frame phase on pause and only adds a masked outside aura to baked materials', () => {
  const layer = readFileSync(new URL('./collectible-aura-layer.tsx', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('./collectible-detail.tsx', import.meta.url), 'utf8');
  const clock = readFileSync(new URL('./grade-material-layer.tsx', import.meta.url), 'utf8');
  assert.match(detail, /const auraActive = Boolean\(snapshot\.effects\?\.some\([^\n]+\)\)\s*&& playing && moving && !dragging && !scene && cardVisible/);
  assert.match(detail, /useGradeMaterialClock\(auraActive\)/);
  assert.match(clock, /clock\.set\(\(value\) => value \+ Math\.min\(frame\.timeSincePreviousFrame \?\? 0, 50\)\)/);
  assert.match(clock, /frameCallback\.setActive\(active && motionEnabled && foreground\)/);
  assert.doesNotMatch(clock.slice(clock.indexOf('export function useGradeMaterialClock'), clock.indexOf('function Glint')), /clock\.set\(0\)/);
  assert.match(layer, /clock\.get\(\)/);
  assert.doesNotMatch(layer, /moving \?[^;]*clock|setInterval|setTimeout|Image|dataUrl|Date\.now/);
  assert.match(layer, /effect\.type === 'flame' && effect\.target === 'aura' && effectStrengthValue\(effect\) > 0/);
  assert.match(layer, /maskType="luminance"/);
  assert.match(layer, /<CollectibleFaceOutline shape=\{shape\} fill="black"/);
  assert.ok(detail.indexOf('<CollectibleAuraLayer') < detail.indexOf('<CollectibleEdgeLayer'), 'aura is behind the physical coin');
});

test('flame paths are shared UI-frame data and animated props never invoke imported geometry helpers', () => {
  const layer = readFileSync(new URL('./collectible-aura-layer.tsx', import.meta.url), 'utf8');
  const geometry = readFileSync(new URL('./collectible-aura.ts', import.meta.url), 'utf8');
  const props = layer.slice(layer.indexOf('const gradientProps = useAnimatedProps'), layer.indexOf('return <>'));
  assert.match(props, /d: tongue\.d, opacity: tongue\.alpha/);
  assert.doesNotMatch(props, /collectibleFlame(?:Path|FrameForAnchors)\(/);
  assert.match(layer, /const frame = useDerivedValue\([\s\S]*?d: collectibleFlamePath\(tongue\)/);
  for (const helper of ['collectibleFlameFrameForAnchors', 'collectibleFlamePath', 'effectSpeedValue', 'effectStrengthValue']) {
    assert.match(geometry, new RegExp(`export function ${helper}\\([^{]*\\{\\s*'worklet';`), `${helper} must remain UI-runtime serializable`);
  }
});
