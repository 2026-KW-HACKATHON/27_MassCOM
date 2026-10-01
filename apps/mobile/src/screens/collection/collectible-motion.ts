export type ParticlePoint = { x: number; y: number; color: string };

const PARTICLE_COLORS: Record<string, readonly string[]> = {
  confetti: ['#ffb165', '#8adcc0', '#da9fdd'],
  snow: ['#ffffff', '#eaf6ff', '#d7ecff'],
  petals: ['#f7b6c8', '#f49bc1', '#fcd5e4'],
  sparkles: ['#fff4c2', '#ffe98a', '#ffffff'],
};

/** Mirrors apps/production-web/assets/collectible-model.mjs particleAt; tests/fixtures/collectible-vectors.json covers both sides. */
export function particleAt(kind: string, i: number, phase: number): ParticlePoint {
  const colors = PARTICLE_COLORS[kind] ?? PARTICLE_COLORS.confetti!;
  const p = Number.isFinite(phase) ? Math.min(1, Math.max(0, phase)) : 0;
  const color = colors[i % colors.length]!;
  if (kind === 'confetti') return { x: Math.sin(i * 7) * p, y: Math.cos(i * 3) * p + p * p * .3, color };
  if (kind === 'snow') return { x: Math.sin(i * 5 + p * Math.PI * 2) * .4, y: p - .5, color };
  if (kind === 'petals') return { x: Math.sin(i * 3 + p * Math.PI) * .5, y: p - .5 + Math.sin(p * Math.PI * 2 + i) * .08, color };
  return { x: Math.cos(i * 11 + p * Math.PI * 2) * .4 * p, y: Math.sin(i * 13 + p * Math.PI * 2) * .4 * p, color };
}

const ANGLE_FRAME_START = -82.5, ANGLE_FRAME_STEP = 15, ANGLE_FRAME_COUNT = 12;

/** Mirrors angleFrameIndex in collectible-model.mjs: nearest two sprite cells for a rotation angle, plus their crossfade mix. */
export function angleFrameBlend(angleDeg: number): { back: true } | { back: false; index: number; next: number; blend: number } {
  const normalized = ((angleDeg % 360) + 540) % 360 - 180;
  if (Math.abs(normalized) > 90) return { back: true };
  const position = Math.min(ANGLE_FRAME_COUNT - 1, Math.max(0, (normalized - ANGLE_FRAME_START) / ANGLE_FRAME_STEP));
  const index = Math.min(ANGLE_FRAME_COUNT - 2, Math.floor(position));
  return { back: false, index, next: Math.min(ANGLE_FRAME_COUNT - 1, index + 1), blend: Math.min(1, Math.max(0, position - index)) };
}

/** Sprite cell for a looping living-picture animation; clockMs=0 (reduce motion) always lands on cell 0. */
export function livingCell(clockMs: number, periodMs: number, count: number): number {
  if (!Number.isFinite(clockMs) || !(periodMs > 0) || !(count > 0)) return 0;
  const phase = (((clockMs % periodMs) + periodMs) % periodMs) / periodMs;
  return Math.min(count - 1, Math.floor(phase * count));
}

// 등급별 프레임 없이 각도만 재생하는 once 재생의 표시 시간(ms); collectible-model.mjs ONCE_MS와 값이 같아야 한다.
export const ONCE_MS: Record<string, number> = { rotate: 4000, shine: 3500, sparkle: 3500, stamp: 3500, float: 2400, pulse: 2400, confetti: 2000 };

export type MotionLike = { type: string; playback: 'once' | 'loop' };

export function onceMotionTypes(motions: readonly MotionLike[] | undefined): string[] {
  return (motions ?? []).filter((motion) => motion.playback === 'once').map((motion) => motion.type);
}

export function firstLoopMotionType(motions: readonly MotionLike[] | undefined): string | undefined {
  return (motions ?? []).find((motion) => motion.playback === 'loop')?.type;
}

/** 획득 직후(intro)는 once 모션을 순서대로 다 보여준 다음 첫 loop 모션, 나중에 도감에서 열면 그 loop 모션만 자동재생한다. */
export function motionAutoplaySequence(motions: readonly MotionLike[] | undefined, intro: boolean): readonly string[] {
  const loop = firstLoopMotionType(motions);
  if (!intro) return loop ? [loop] : [];
  return loop ? [...onceMotionTypes(motions), loop] : onceMotionTypes(motions);
}

/** Shared by the native detail timer and its presentation; milliseconds never become seconds. */
export function collectibleMotionFrame(type: string, milliseconds: number, size: number) {
  const time = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  const phase = (time % 5000) / 2000;
  return {
    rotation: type === 'rotate' ? time / 90 : 0,
    lift: type === 'float' ? Math.sin(time / 800) * size * .025 : 0,
    scale: type === 'pulse' ? 1 + Math.sin(time / 900) * .025
      : type === 'stamp' ? 1 + Math.max(0, 1 - (time % 3500) / 500) * .18 : 1,
    light: type === 'shine' || type === 'sparkle',
    lightX: (time % 3500) / 3500 * size * 2 - size,
    lightOpacity: type === 'sparkle' ? .15 + Math.max(0, Math.sin(time / 700)) * .4 : .4,
    particles: type === 'confetti' && phase < 1,
    particlePhase: Math.min(1, phase),
  };
}
