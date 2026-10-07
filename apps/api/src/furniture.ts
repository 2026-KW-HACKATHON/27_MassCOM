export type FurnitureCatalogItem = { id: string; name: string; kind: 'FURNITURE';
  assetId: string | null; priceMileage: number | null; sellable: boolean };
export type FurnitureInventoryItem = { id: string; itemId: string };
export type FurnitureSnapshot = { catalog: FurnitureCatalogItem[]; inventory: FurnitureInventoryItem[] };
export type FurniturePurchase = { inventoryItem: FurnitureInventoryItem; balance: number; replayed: boolean };

export interface FurnitureService {
  get(accountId: string): Promise<FurnitureSnapshot>;
  purchase(input: { accountId: string; itemId: string; requestId: string }): Promise<FurniturePurchase>;
}

export class FurnitureError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'FurnitureError'; }
}
