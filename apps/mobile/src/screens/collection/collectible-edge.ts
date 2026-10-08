export type EdgePoint = { x: number; y: number };
export type EdgeSlot = EdgePoint & { slot: number; outwardX: number };
export type EdgeGroove = { slot: number; x1: number; x2: number; y: number };

export const COLLECTIBLE_EDGE_SLOTS = 144;
export const COLLECTIBLE_EDGE_GAP = 2;

/** Matches the native face's 100-unit outline; vertices run clockwise. */
export function collectibleEdgeOutline(shape: string, size: number): EdgePoint[] {
  const points: EdgePoint[] = [];
  if (shape === 'stamp') {
    for (const [cx, cy, start] of [[85, 10, -90], [85, 90, 0], [15, 90, 90], [15, 10, 180]]) {
      for (let step = 0; step <= 12; step++) {
        const radians = (start! + step * 90 / 12) * Math.PI / 180;
        points.push({ x: (cx! + Math.cos(radians) * 6) * size / 100, y: (cy! + Math.sin(radians) * 6) * size / 100 });
      }
    }
    return points;
  }
  const serrated = shape === 'serrated' || shape === 'gear';
  const count = serrated ? 48 : 96;
  for (let index = 0; index < count; index++) {
    const radians = -Math.PI / 2 + index * Math.PI * 2 / count;
    const radius = serrated && index % 2 ? 36.8 : 46;
    points.push({ x: (50 + Math.cos(radians) * radius) * size / 100, y: (50 + Math.sin(radians) * radius) * size / 100 });
  }
  return points;
}

/** Slot IDs belong to the physical perimeter, independent of thickness and rotation. */
export function collectibleEdgeSlots(points: readonly EdgePoint[]): EdgeSlot[] {
  const lengths = points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  if (!Number.isFinite(perimeter) || perimeter <= 0) return [];
  let segment = 0;
  let preceding = 0;
  return Array.from({ length: COLLECTIBLE_EDGE_SLOTS }, (_, slot) => {
    const distance = perimeter * slot / COLLECTIBLE_EDGE_SLOTS;
    while (segment < points.length - 1 && preceding + lengths[segment]! < distance) {
      preceding += lengths[segment]!;
      segment++;
    }
    const point = points[segment]!;
    const next = points[(segment + 1) % points.length]!;
    const length = lengths[segment]!;
    const fraction = (distance - preceding) / length;
    return { slot, x: point.x + (next.x - point.x) * fraction, y: point.y + (next.y - point.y) * fraction,
      outwardX: (next.y - point.y) / length };
  });
}

const polygonPath = (points: readonly EdgePoint[]) => points.length
  ? `M${points.map(point => `${point.x},${point.y}`).join('L')}Z` : '';

/** A swept face backing minus the current face exposes only the physical side. */
export function collectibleEdgeGeometry(shape: string, size: number, horizontal: number, depth: number) {
  const points = collectibleEdgeOutline(shape, size);
  const shift = Math.max(0, -depth);
  const project = (point: EdgePoint): EdgePoint => ({ x: size / 2 + (point.x - size / 2) * horizontal + shift, y: point.y });
  const front = points.map(project);
  const back = front.map(point => ({ x: point.x + depth, y: point.y }));
  const sidePaths = front.map((point, index) => polygonPath([point, front[(index + 1) % front.length]!, back[(index + 1) % back.length]!, back[index]!]));
  const absDepth = Math.abs(depth);
  const grooves: EdgeGroove[] = [];
  if (absDepth > .35) {
    for (const slot of collectibleEdgeSlots(points)) {
      if (Math.sign(depth) * slot.outwardX <= .12) continue;
      const point = project(slot);
      if (grooves.some(groove => Math.hypot(point.x - groove.x1, point.y - groove.y) < COLLECTIBLE_EDGE_GAP)) continue;
      grooves.push({ slot: slot.slot, x1: point.x, x2: point.x + depth, y: point.y });
    }
  }
  const strength = Math.min(1, Math.max(0, (absDepth - .35) / 2.65));
  const darkOpacity = .08 + .33 * strength;
  return { width: size + absDepth, leftOffset: Math.min(0, depth), frontPath: polygonPath(front), backPath: polygonPath(back), sidePaths, grooves,
    darkOpacity, highlightOpacity: darkOpacity * .85, strokeWidth: .55 + .2 * strength };
}
