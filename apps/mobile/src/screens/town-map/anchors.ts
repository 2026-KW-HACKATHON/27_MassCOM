/** A point on the town map art as a fraction of its width (x) and height (y). */
export type Anchor = { readonly x: number; readonly y: number };

/** `town-map.png` is 1024x1536 portrait; pins are laid out on this ratio. */
export const TOWN_MAP_ART = { width: 1024, height: 1536 } as const;

/**
 * One anchor per shop building in the art, from top to bottom (measured on the 1024x1536 file, each on its building's roof so the
 * awning stays visible): 0 bakery, 1 fruit stand, 2 red cafe, 3 blue bookshop, 4 purple shop, 5 yellow shop, 6 pink shop, 7 blue shop.
 */
export const TOWN_MAP_ANCHORS: readonly Anchor[] = [
  { x: 0.181, y: 0.105 },
  { x: 0.596, y: 0.092 },
  { x: 0.869, y: 0.226 },
  { x: 0.156, y: 0.342 },
  { x: 0.859, y: 0.466 },
  { x: 0.859, y: 0.668 },
  { x: 0.420, y: 0.745 },
  { x: 0.781, y: 0.850 },
];

export const ANCHOR_COUNT = TOWN_MAP_ANCHORS.length;

/**
 * The demo app's virtual shops A, B and C (local and hosted seeds share these ids) always take the same, far apart buildings:
 * bakery (top left), purple shop (right, middle) and pink shop (lower left), so the demo screen never changes.
 */
export const SHOWCASE_ANCHORS: Readonly<Record<string, number>> = {
  'showcase-local-merchant': 0,
  'showcase-local-merchant-b': 4,
  'showcase-local-merchant-c': 6,
};
// A Map, so an id such as "constructor" is never mistaken for an inherited key.
const fixedAnchors = new Map(Object.entries(SHOWCASE_ANCHORS));

/** FNV-1a (32 bit) over the id's UTF-16 code units: the same id hashes the same on every device. */
function fnv1a(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The building a shop would like: its id's hash, folded onto the anchors. */
export function preferredAnchor(merchantId: string): number {
  return fnv1a(merchantId) % ANCHOR_COUNT;
}

/**
 * Gives every shop a building. Demo shops take their fixed ones first; the rest take their hashed one, or the next free one
 * after it. Shops are placed in id order (code unit order), so the API's list order never moves a pin. Shops beyond the
 * eighth are returned in `overflow`, in the same id order.
 */
export function assignAnchors(merchantIds: readonly string[]): { placed: Map<string, number>; overflow: string[] } {
  const ids = [...new Set(merchantIds)].sort();
  const slots = new Map<string, number>();
  const taken = new Set<number>();
  for (const id of ids) {
    const fixed = fixedAnchors.get(id);
    if (fixed === undefined) continue;
    slots.set(id, fixed);
    taken.add(fixed);
  }
  const overflow: string[] = [];
  for (const id of ids) {
    if (slots.has(id)) continue;
    const start = preferredAnchor(id);
    let slot: number | undefined;
    for (let step = 0; step < ANCHOR_COUNT && slot === undefined; step += 1) {
      const candidate = (start + step) % ANCHOR_COUNT;
      if (!taken.has(candidate)) slot = candidate;
    }
    if (slot === undefined) {
      overflow.push(id);
    } else {
      slots.set(id, slot);
      taken.add(slot);
    }
  }
  // Rebuilt in id order so iterating the map does not depend on which shops were fixed.
  const placed = new Map(ids.filter((id) => slots.has(id)).map((id) => [id, slots.get(id)!] as const));
  return { placed, overflow };
}
