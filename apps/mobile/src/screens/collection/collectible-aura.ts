import type { CollectibleEffect } from '../../commerce/collectible-artwork';

import { collectibleEdgeOutline, collectibleEdgeSlots, type EdgePoint } from './collectible-edge';

export type FlameAnchor = EdgePoint & { slot: number; phase: number };
export type FlameTongue = FlameAnchor & { tipX: number; tipY: number; width: number; alpha: number };
export const FLAME_PERIOD_MS = 1200;

export function effectStrengthValue(effect: Pick<CollectibleEffect, 'strength'>, fallback = 45): number {
  'worklet';
  const value = effect.strength;
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback;
}

export function effectSpeedValue(effect: Pick<CollectibleEffect, 'speed'>, fallback = 1): number {
  'worklet';
  const value = effect.speed;
  return value !== undefined && Number.isFinite(value) ? Math.min(3, Math.max(.25, value)) : fallback;
}

/** Fixed physical slots prevent the flame bases jumping when a loop wraps. */
export function collectibleFlameAnchors(shape: string, size: number): FlameAnchor[] {
  if (!Number.isFinite(size) || size <= 0) return [];
  const perimeter = collectibleEdgeSlots(collectibleEdgeOutline(shape, size));
  const count = shape === 'stamp' ? 34 : shape === 'serrated' || shape === 'gear' ? 38 : 30;
  const anchors: FlameAnchor[] = [];
  for (let slot = 0; slot < count; slot++) {
    const point = perimeter[Math.floor(slot / count * perimeter.length)]!;
    const x = point.x - size / 2;
    const y = point.y - size / 2;
    if (y <= size * .36) anchors.push({ slot, x, y, phase: slot / count });
  }
  return anchors;
}

/** Same 1.2-second rising-wave formulas as the web renderer, with the native face perimeter. */
export function collectibleFlameFrameForAnchors(anchors: readonly FlameAnchor[], size: number, angleDeg = 0, timeMs = 0, speed = 1, strength = 50): FlameTongue[] {
  'worklet';
  const amount = effectStrengthValue({ strength }, 0) / 100;
  if (!amount || !Number.isFinite(size) || size <= 0) return [];
  const phase = ((((Number.isFinite(timeMs) ? timeMs : 0) * effectSpeedValue({ speed }) / FLAME_PERIOD_MS) % 1) + 1) % 1;
  const anglePhase = Math.sin((Number.isFinite(angleDeg) ? angleDeg : 0) * Math.PI / 180) * .18;
  return anchors.map(({ slot, x, y, phase: position }) => {
    const centerLength = Math.max(1, Math.hypot(x, y));
    const outwardX = x / centerLength;
    const outwardY = y / centerLength;
    const wave = Math.sin(slot * 2.17 + phase * Math.PI * 2 + anglePhase * Math.PI);
    const lick = Math.max(0, .45 + .55 * wave);
    const upward = .65 + .35 * Math.max(0, -outwardY);
    const length = size * (.035 + .085 * amount) * (.55 + lick * .75) * upward;
    const width = size * (.014 + .026 * amount) * (.7 + lick * .4);
    const baseOffset = size * (.012 + .018 * amount);
    return { slot, x: x + outwardX * baseOffset, y: y + outwardY * baseOffset,
      tipX: x + outwardX * baseOffset * .5 + wave * size * .018, tipY: y - length,
      width, alpha: (.28 + .42 * lick) * amount, phase: position };
  });
}

export function collectibleFlameFrame(shape: string, size: number, angleDeg = 0, timeMs = 0, speed = 1, strength = 50): FlameTongue[] {
  return collectibleFlameFrameForAnchors(collectibleFlameAnchors(shape, size), size, angleDeg, timeMs, speed, strength);
}

export function collectibleFlamePath(tongue: FlameTongue): string {
  'worklet';
  const { x, y, width, tipX, tipY } = tongue;
  const middleY = (y + tipY) / 2;
  return `M${x - width},${y}Q${x},${middleY} ${tipX},${tipY}Q${x + width},${middleY} ${x + width},${y}Z`;
}
