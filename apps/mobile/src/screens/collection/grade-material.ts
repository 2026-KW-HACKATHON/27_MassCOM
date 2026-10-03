export type GradeMaterial = 'prism' | 'gold' | 'silver' | 'bronze';

export type GradeMaterialPreset = {
  material: GradeMaterial;
  tint: string;
  colors: readonly string[];
  bandWidth: number;
  baseOpacity: number;
  intensity: number;
  sweepPeriodMs: number;
  cardPeriodMs: number;
  glintCount: number;
  glintFloor: number;
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

/** 바탕 불투명도와 반사띠 중심 광량을 분리해 사진 위에서도 재질을 읽을 수 있게 한다. */
export const gradeMaterialPresets: Readonly<Record<GradeMaterial, GradeMaterialPreset>> = {
  bronze: { material: 'bronze', tint: '#BE8755', colors: ['#E3BB8B', '#FFF1DC', '#A9673F'],
    bandWidth: .18, baseOpacity: .035, intensity: .12, sweepPeriodMs: 11000, cardPeriodMs: 11000, glintCount: 0, glintFloor: 0, rainbowStops: [] },
  silver: { material: 'silver', tint: '#BBD4EA', colors: ['#D3E2EF', '#FFFFFF', '#8DACC8'],
    bandWidth: .22, baseOpacity: .10, intensity: .50, sweepPeriodMs: 3400, cardPeriodMs: 4000, glintCount: 0, glintFloor: 0, rainbowStops: [] },
  gold: { material: 'gold', tint: '#F5B82E', colors: ['#B9750C', '#FFE18A', '#FFFFFF', '#D99A1C'],
    bandWidth: .22, baseOpacity: .22, intensity: .80, sweepPeriodMs: 3000, cardPeriodMs: 4000, glintCount: 5, glintFloor: .60, rainbowStops: [] },
  prism: { material: 'prism', tint: '#B8E9FF', colors: ['#67E8F9', '#E8C5FF', '#FFFFFF'],
    bandWidth: .24, baseOpacity: .44, intensity: .85, sweepPeriodMs: 2800, cardPeriodMs: 4000, glintCount: 10, glintFloor: 0,
    rainbowStops: ['#52E5EF', '#9B72FF', '#F68CCF', '#FFD66F', '#7EE7BB', '#52E5EF'] },
};

export const PRISM_FOIL_STOPS = ['#00E5FF', '#8E4DFF', '#FF4ABA', '#FFD447', '#39EDAC', '#00E5FF'] as const;
// 일반 알파 합성으로 흰 그림에도 샴페인 금빛과 유색 반사띠가 남게 한다.
export const GOLD_WARM_STOPS = ['#FFB300', '#FFE08A', '#C98A00'] as const;
export const GOLD_BAND_STOPS = [
  { offset: 0, color: '#FFC23A', opacity: 0 },
  { offset: .22, color: '#FFC23A', opacity: .65 },
  { offset: .42, color: '#FFE7A0', opacity: .65 },
  { offset: .5, color: '#FFFFFF', opacity: 1 },
  { offset: .58, color: '#FFE7A0', opacity: .65 },
  { offset: .78, color: '#FFC23A', opacity: .65 },
  { offset: 1, color: '#FFC23A', opacity: 0 },
] as const;
export const RAINBOW_PERIODS = 8;

/** SVG 반복 속성에 의존하지 않고 화면을 덮는 색 주기를 나열해 정확히 한 주기만큼 대각 이동한다. */
export function rainbowGradientAt(phase: number) {
  'worklet';
  const dx = .32;
  const dy = -.16;
  const x1 = -(2 + phase) * dx;
  const y1 = .5 - (2 + phase) * dy;
  return { x1, y1, x2: x1 + RAINBOW_PERIODS * dx, y2: y1 + RAINBOW_PERIODS * dy };
}

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
  rainbowGradient: ReturnType<typeof rainbowGradientAt>;
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
  // 주기의 80% 동안 가로지르고 나머지는 윤곽 밖에서 쉰다. 반복 위치 초기화는 그림 밖에서 일어난다.
  const drift = active ? -2.2 + Math.min(1, cycle / .8) * 4.4 : 0;
  const rainbow = .25 + x * .28 + y * .18 + cycle;
  const rainbowPhase = ((rainbow % 1) + 1) % 1;
  const glintOpacities = Array.from({ length: preset.glintCount }, (_, index) => {
    const wave = active ? Math.max(0, Math.sin(cycle * Math.PI * 4 + index * 2.399 + x * 1.7 + y)) : .70;
    return unit(preset.glintFloor + (1 - preset.glintFloor) * wave ** 2 * (.65 + preset.intensity * .35));
  });
  return {
    bandOffset: .5 + x * .8 + y * .3 + drift,
    bandAngle: -25 + x * 6 - y * 5,
    rainbowPhase,
    rainbowGradient: rainbowGradientAt(rainbowPhase),
    highlightX: unit(.5 + x * .3 + Math.sin(cycle * Math.PI * 2) * .13),
    highlightY: unit(.42 + y * .28 - Math.sin(cycle * Math.PI * 2) * .08),
    glintOpacities,
  };
}
