import { shapePoints } from './collectible-model.mjs';

// One fixed set of reeds follows the perimeter. Smaller projections omit crowded
// reeds instead of squeezing more stripes into an already narrow metal edge.
export function collectibleEdgeGrooves(shape, size, horizontal, signedDepth) {
  const depth = Math.abs(signedDepth);
  if (depth <= .35) return [];
  const points = shapePoints(shape, size, size);
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return { point, dx: next.x - point.x, dy: next.y - point.y, length: Math.hypot(next.x - point.x, next.y - point.y) };
  });
  const perimeter = segments.reduce((sum, segment) => sum + segment.length, 0);
  const grooves = [];
  const direction = Math.sign(signedDepth);
  let segmentIndex = 0, segmentStart = 0;
  for (let slot = 0; slot < 144; slot++) {
    const along = slot * perimeter / 144;
    while (segmentIndex < segments.length - 1 && along > segmentStart + segments[segmentIndex].length) {
      segmentStart += segments[segmentIndex++].length;
    }
    const segment = segments[segmentIndex];
    if (direction * segment.dy / segment.length <= .12) continue;
    const fraction = (along - segmentStart) / segment.length;
    const x = (segment.point.x + segment.dx * fraction - size / 2) * horizontal;
    const y = segment.point.y + segment.dy * fraction - size / 2;
    if (grooves.some(groove => Math.hypot(groove.x - x, groove.y - y) < 2)) continue;
    grooves.push({ slot, x, y, frontX: x - signedDepth / 2, backX: x + signedDepth / 2 });
  }
  return grooves;
}

export function collectibleEdgeContrast(signedDepth) {
  const strength = Math.min(1, Math.max(0, (Math.abs(signedDepth) - .35) / 2.65));
  return { opacity: .08 + .33 * strength, lineWidth: .55 + .2 * strength };
}
