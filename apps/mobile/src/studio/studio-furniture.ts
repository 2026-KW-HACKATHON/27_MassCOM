import type { FurniturePlacement, FurnitureSnapshot, Studio } from './studio-api';

export function ownedFurniture(snapshot: FurnitureSnapshot, kind: 'FURNITURE' | 'WALL' | 'FLOOR') {
  const catalog = new Map(snapshot.catalog.filter((item) => item.kind === kind).map((item) => [item.id, item]));
  return snapshot.inventory.flatMap((entry) => {
    const item = catalog.get(entry.itemId);
    return item ? [{ ...entry, item }] : [];
  });
}

export function placeFurniture(studio: Studio, inventoryId: string, owned: FurnitureSnapshot): Studio {
  if (!ownedFurniture(owned, 'FURNITURE').some((entry) => entry.id === inventoryId)
    || studio.furniture.some((entry) => entry.inventoryId === inventoryId) || studio.furniture.length >= 30) return studio;
  return { ...studio, furniture: [...studio.furniture, { inventoryId, x: .5, y: .65, rotation: 0 }] };
}

export function changeFurniture(studio: Studio, inventoryId: string,
  update: (placement: FurniturePlacement) => FurniturePlacement): Studio {
  return { ...studio, furniture: studio.furniture.map((entry) => entry.inventoryId === inventoryId ? update(entry) : entry) };
}

export function clampPosition(value: number): number { return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000)); }

export function removeFurniture(studio: Studio, inventoryId: string): Studio {
  return { ...studio, furniture: studio.furniture.filter((entry) => entry.inventoryId !== inventoryId) };
}

export function studioDirty(saved: Studio, draft: Studio): boolean { return JSON.stringify(saved) !== JSON.stringify(draft); }

export function studioNeedsReload(loadedFor: { client: object; requestKey: string } | null, client: object, requestKey: string): boolean {
  return loadedFor?.client !== client || loadedFor.requestKey !== requestKey;
}

/** Keep edits made after a save started; only replace an unchanged draft with the server result. */
export function studioAfterSave(submitted: Studio, current: Studio | undefined, saved: Studio): Studio {
  return current && studioDirty(submitted, current) ? current : saved;
}
