export type GradeMaterial = 'prism' | 'gold' | 'silver' | 'bronze';

export type GradeMaterialPreset = {
  material: GradeMaterial;
  tint: string;
  colors: readonly string[];
  bandWidth: number;
  baseOpacity: number;
  intensity: number;
  sweepPeriodMs: number;
  glintCount: number;
  rainbowStops: readonly string[];
};

/** 테두리 색과 반사가 판별을 공유하고 기존 특별 등급도 프리즘으로 취급한다. */
export function gradeMaterialFor(gradeId: string, gradeName: string): GradeMaterial {
  'worklet';
  const grade = `${gradeId} ${gradeName}`.toLowerCase();
  if (/prism|special|프리즘|특별/.test(grade)) return 'prism';
  if (/gold|골드|금색|금등급/.test(grade)) return 'gold';
  if (/silver|실버|은색|은등급/.test(grade)) return 'silver';
  return 'bronze';
}

/** 원래 그림을 보존하는 낮은 바탕 광량과 좁고 밝은 반사띠를 분리한다. */
export const gradeMaterialPresets: Readonly<Record<GradeMaterial, GradeMaterialPreset>> = {
  bronze: { material: 'bronze', tint: '#BE8755', colors: ['#E3BB8B', '#FFF1DC', '#A9673F'],
    bandWidth: .18, baseOpacity: .035, intensity: .12, sweepPeriodMs: 11000, glintCount: 0, rainbowStops: [] },
  silver: { material: 'silver', tint: '#BBD4EA', colors: ['#D3E2EF', '#FFFFFF', '#8DACC8'],
    bandWidth: .22, baseOpacity: .065, intensity: .24, sweepPeriodMs: 9500, glintCount: 0, rainbowStops: [] },
  gold: { material: 'gold', tint: '#F5B82E', colors: ['#B9750C', '#FFE18A', '#FFFFFF', '#D99A1C'],
    bandWidth: .27, baseOpacity: .13, intensity: .56, sweepPeriodMs: 8000, glintCount: 4, rainbowStops: [] },
  prism: { material: 'prism', tint: '#B8E9FF', colors: ['#67E8F9', '#E8C5FF', '#FFFFFF'],
    bandWidth: .32, baseOpacity: .21, intensity: .62, sweepPeriodMs: 7200, glintCount: 8,
    rainbowStops: ['#52E5EF', '#9B72FF', '#F68CCF', '#FFD66F', '#7EE7BB', '#52E5EF'] },
};

function clampTilt(value: number): number {
  'worklet';
  return Number.isNaN(value) ? 0 : Math.max(-1, Math.min(1, value));
}

function unit(value: number): number {
  'worklet';
  return Math.max(0, Math.min(1, value));
}

export type MaterialTilt = { x: number; y: number };

/** 회전은 정면을 기준으로, 끌기·중력은 별도 조명 입력으로 더한다. 면 판정은 건드리지 않는다. */
export function combineMaterialTilt(angleDegrees: number, drag: MaterialTilt, gravity: MaterialTilt): MaterialTilt {
  'worklet';
  const angle = Number.isFinite(angleDegrees) ? angleDegrees : 0;
  return {
    x: clampTilt(Math.sin(angle * Math.PI / 180) * .55 + clampTilt(drag.x) * .6 + clampTilt(gravity.x) * .65),
    y: clampTilt(clampTilt(drag.y) * .6 + clampTilt(gravity.y) * .7),
  };
}

export type ReflectionInput = { tiltX: number; tiltY: number; timeMs: number; active?: boolean };
export type ReflectionFrame = {
  bandOffset: number;
  bandAngle: number;
  rainbowPhase: number;
  highlightX: number;
  highlightY: number;
  glintOpacities: number[];
};

/** 정규화된 좌표만 계산한다. 비활성 프레임은 시계·센서값과 무관하게 중앙에 고정한다. */
export function reflectionAt(input: ReflectionInput, preset: GradeMaterialPreset): ReflectionFrame {
  'worklet';
  const active = input.active !== false;
  const x = active ? clampTilt(input.tiltX) : 0;
  const y = active ? clampTilt(input.tiltY) : 0;
  // 먼저 나머지를 취해 매우 큰 시간에도 삼각함수 입력이 유한하고 정밀하게 유지되도록 한다.
  const time = active && Number.isFinite(input.timeMs) ? Math.max(0, input.timeMs) : 0;
  const cycle = (time % preset.sweepPeriodMs) / preset.sweepPeriodMs;
  const drift = active ? Math.sin(cycle * Math.PI * 2) * .7 : 0;
  const rainbow = .25 + x * .28 + y * .18 + cycle;
  const glintOpacities = Array.from({ length: preset.glintCount }, (_, index) => {
    const wave = active ? Math.max(0, Math.sin(cycle * Math.PI * 4 + index * 2.399 + x * 1.7 + y)) : .46;
    return unit(.12 + wave ** 4 * preset.intensity);
  });
  return {
    bandOffset: .5 + x * .5 + y * .22 + drift,
    bandAngle: -28 + x * 14 - y * 10,
    rainbowPhase: ((rainbow % 1) + 1) % 1,
    highlightX: unit(.5 + x * .3 + drift * .13),
    highlightY: unit(.42 + y * .28 - drift * .08),
    glintOpacities,
  };
}
