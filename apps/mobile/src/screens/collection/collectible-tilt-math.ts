/**
 * Pure gravity-vector → display-angle mapping for <TiltSensor>. Kept separate from the .tsx so it can be
 * unit-tested directly (tests can't import .tsx). One call per sensor sample; the caller keeps the smoothed
 * value between calls (see collectible-tilt.tsx).
 */

// ponytail: 기기마다 센서 좌표계가 달라 부호·세기를 하나의 숫자로 조정한다. 실기 QA에서 반대로 기울면 -1로 뒤집는다.
export const TILT_GAIN = 1;
const LOW_PASS_ALPHA = .2;
const DEADZONE_DEG = 2;
const CLAMP_DEG = 30;

/** One low-pass step from a raw gravity sample to a smoothed, deadzoned, clamped tilt angle in degrees. */
export function tiltStep(gravityX: number, gravityY: number, previousSmoothedDeg: number): number {
  const raw = Math.atan2(gravityX, gravityY) * 180 / Math.PI * TILT_GAIN;
  const previous = Number.isFinite(previousSmoothedDeg) ? previousSmoothedDeg : 0;
  const smoothed = previous + (raw - previous) * LOW_PASS_ALPHA;
  const clamped = Math.max(-CLAMP_DEG, Math.min(CLAMP_DEG, smoothed));
  return Math.abs(clamped) < DEADZONE_DEG ? 0 : clamped;
}

/** Only this rounded value should ever cross the UI-thread → JS bridge, and only when it changes. */
export function tiltEmittedDegrees(smoothedDeg: number): number {
  return Math.round(smoothedDeg);
}
