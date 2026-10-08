import { clamp, shapePoints } from './collectible-model.mjs';

export function effectStrengthValue(effect, fallback = 45) {
  return clamp(effect?.strength ?? fallback, 0, 100, fallback);
}

export function effectSpeedValue(effect, fallback = 1) {
  return clamp(effect?.speed ?? fallback, .25, 3, fallback);
}

/** Keep the first four active layers in saved order to bound per-frame animation work. */
export function flameAuraEffects(effects = []) {
  return effects.filter(effect => effect.type === 'flame' && effect.target === 'aura' && effectStrengthValue(effect) > 0).slice(0, 4);
}

export function flameFrame(shape, size, angleDeg = 0, timeMs = 0, speed = 1, strength = 50) {
  const amount = clamp(strength, 0, 100, 0) / 100;
  if (!amount || !Number.isFinite(size) || size <= 0) return [];
  const points = shapePoints(shape, size, size);
  const count = shape === 'stamp' ? 34 : shape === 'serrated' ? 38 : 30;
  const phase = ((((Number.isFinite(timeMs) ? timeMs : 0) * effectSpeedValue({ speed }) / 1200) % 1) + 1) % 1;
  const anglePhase = Math.sin((Number.isFinite(angleDeg) ? angleDeg : 0) * Math.PI / 180) * .18;
  const tongues = [];
  for (let slot = 0; slot < count; slot++) {
    const position = slot / count;
    const point = points[Math.floor(position * points.length) % points.length];
    const x = point.x - size / 2, y = point.y - size / 2;
    if (y > size * .36) continue;
    const centerLength = Math.max(1, Math.hypot(x, y));
    const outward = { x: x / centerLength, y: y / centerLength };
    const wave = Math.sin(slot * 2.17 + phase * Math.PI * 2 + anglePhase * Math.PI);
    const lick = Math.max(0, .45 + .55 * wave);
    const upward = .65 + .35 * Math.max(0, -outward.y);
    const length = size * (.035 + .085 * amount) * (.55 + lick * .75) * upward;
    const width = size * (.014 + .026 * amount) * (.7 + lick * .4);
    const baseOffset = size * (.012 + .018 * amount);
    tongues.push({
      slot,
      x: x + outward.x * baseOffset,
      y: y + outward.y * baseOffset,
      tipX: x + outward.x * baseOffset * .5 + wave * size * .018,
      tipY: y - length,
      width,
      alpha: (.28 + .42 * lick) * amount,
      phase: position,
    });
  }
  return tongues;
}
