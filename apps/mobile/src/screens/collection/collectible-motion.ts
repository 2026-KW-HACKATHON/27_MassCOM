import type { CollectibleAngleFrames } from '@/commerce/collectible-artwork';

export type ParticlePoint = { x: number; y: number; color: string };

/** 옆면 경계(±90도)는 앞면으로 고정해 부동소수점 cos 부호에 의존하지 않는다. */
export function collectibleFace(angle: number): 'front' | 'back' {
  const normalized = ((angle % 360) + 540) % 360 - 180;
  return Math.abs(normalized) > 90 ? 'back' : 'front';
}

/** 두께는 화면 픽셀 단위. 회전 방향에 맞춰 옆면을 밀고 정면에서는 숨긴다. */
export function collectibleEdgeOffset(angle: number, thickness: number): number {
  const sine = Math.sin(angle * Math.PI / 180);
  return Math.abs(sine) < 1e-10 ? 0 : sine * thickness;
}

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

/** 각도 프레임 크로스페이드용 opacity 쌍. 아래 칸은 항상 완전 불투명으로 두고 위 칸만 섞는다 — 둘 다 섞으면(1-blend / blend)
 * 중간 각도에서 합산 불투명도가 1보다 낮아져 그 아래 갈색 옆면 틴트가 비친다(WP4 리뷰 4). */
export function angleFrameOpacities(blend: number): { lower: number; upper: number } {
  return { lower: 1, upper: Math.min(1, Math.max(0, blend)) };
}

/** 웹 CSS 마스크에도 화면의 두 스프라이트 칸과 같은 합성 알파를 전달한다. */
export function angleFrameWebMask(frames: CollectibleAngleFrames, index: number, next: number, blend: number): string {
  const rows = Math.ceil(frames.count / frames.columns);
  const image = (cell: number, opacity: number) => `<image href="${frames.dataUrl}" x="${-(cell % frames.columns)}" y="${-Math.floor(cell / frames.columns)}" width="${frames.columns}" height="${rows}" preserveAspectRatio="none" opacity="${opacity}"/>`;
  const alpha = angleFrameOpacities(blend);
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${image(index, alpha.lower)}${alpha.upper > 0 ? image(next, alpha.upper) : ''}</svg>`)}`;
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

/** 원본 모션 객체(파티클 포함)로 반환한다; onceMotionTypes는 이 위에 타입 이름만 뽑는다. */
export function onceMotions<T extends MotionLike>(motions: readonly T[] | undefined): T[] {
  return (motions ?? []).filter((motion) => motion.playback === 'once');
}

/** 원본 모션 객체로 반환한다; firstLoopMotionType은 이 위에 타입 이름만 뽑는다. */
export function firstLoopMotion<T extends MotionLike>(motions: readonly T[] | undefined): T | undefined {
  return (motions ?? []).find((motion) => motion.playback === 'loop');
}

export function onceMotionTypes(motions: readonly MotionLike[] | undefined): string[] {
  return onceMotions(motions).map((motion) => motion.type);
}

export function firstLoopMotionType(motions: readonly MotionLike[] | undefined): string | undefined {
  return firstLoopMotion(motions)?.type;
}

/** 획득 직후(intro)는 once 모션을 순서대로 다 보여준 다음 첫 loop 모션, 나중에 도감에서 열면 그 loop 모션만 자동재생한다. */
export function motionAutoplaySequence(motions: readonly MotionLike[] | undefined, intro: boolean): readonly string[] {
  const loop = firstLoopMotionType(motions);
  if (!intro) return loop ? [loop] : [];
  return loop ? [...onceMotionTypes(motions), loop] : onceMotionTypes(motions);
}

/** motionAutoplaySequence와 같은 순서지만 원본 모션 객체를 그대로 담아, 같은 type이라도 once/loop가 다른 particle을
 * 가질 때(예: confetti/once/confetti + confetti/loop/snow) 화면이 정확한 객체를 추적할 수 있게 한다(WP4 리뷰 6). */
export function motionAutoplayObjects<T extends MotionLike>(motions: readonly T[] | undefined, intro: boolean): readonly T[] {
  const loop = firstLoopMotion(motions);
  if (!intro) return loop ? [loop] : [];
  const once = onceMotions(motions);
  return loop ? [...once, loop] : once;
}

/** 자동재생 effect가 전경 복귀·동작 줄이기 토글로 다시 돌 때 쓰는 진입 판단: 이미 한 번 보여줬다면(consumed)
 * intro 여부와 무관하게 loop 모션만 이어간다 — once 시퀀스는 첫 진입과 명시적 "다시 보기"에서만 보여준다(WP4 리뷰 3). */
export function motionEntrySequence<T extends MotionLike>(motions: readonly T[] | undefined, intro: boolean, consumed: boolean): readonly T[] {
  return motionAutoplayObjects(motions, intro && !consumed);
}

export type MotionSequenceEnd<T> = { action: 'hold' } | { action: 'loop'; motion: T } | { action: 'stop' };

/** 재생 시퀀스의 마지막 단계가 끝난 뒤 할 일. 마지막 단계가 이미 loopMotion 그 자체면(연속 loop로 이어지는 중) 그대로
 * 둔다(hold); 그렇지 않으면(once로 끝남) 설정된 loop 모션으로 넘어가거나, 없으면 멈춘다(WP4 리뷰 1). */
export function motionSequenceEnd<T extends MotionLike>(sequence: readonly T[], loopMotion: T | undefined): MotionSequenceEnd<T> {
  const last = sequence[sequence.length - 1];
  if (!last) return { action: 'stop' };
  if (loopMotion && last === loopMotion) return { action: 'hold' };
  return loopMotion ? { action: 'loop', motion: loopMotion } : { action: 'stop' };
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
