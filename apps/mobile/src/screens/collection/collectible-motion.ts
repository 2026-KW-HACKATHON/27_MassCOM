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
