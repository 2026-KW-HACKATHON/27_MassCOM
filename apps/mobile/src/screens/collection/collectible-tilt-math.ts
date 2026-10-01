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

/**
 * One low-pass step from a raw gravity sample to a smoothed, clamped tilt angle in degrees.
 * Returns the value BEFORE the dead zone — the caller must feed this back in as `previousSmoothedDeg`
 * on the next call, so a real but small tilt keeps accumulating across samples instead of the filter
 * state getting reset to 0 every time the (dead-zoned) output happened to read 0.
 */
export function tiltStep(gravityX: number, gravityY: number, previousSmoothedDeg: number): number {
  const raw = Math.atan2(gravityX, gravityY) * 180 / Math.PI * TILT_GAIN;
  const previous = Number.isFinite(previousSmoothedDeg) ? previousSmoothedDeg : 0;
  const smoothed = previous + (raw - previous) * LOW_PASS_ALPHA;
  return Math.max(-CLAMP_DEG, Math.min(CLAMP_DEG, smoothed));
}

/** Only this rounded value should ever cross the UI-thread → JS bridge, and only when it changes. The 2° dead zone is applied here, on the output only, never on the filter state above. */
export function tiltEmittedDegrees(smoothedDeg: number): number {
  return Math.abs(smoothedDeg) < DEADZONE_DEG ? 0 : Math.round(smoothedDeg);
}
