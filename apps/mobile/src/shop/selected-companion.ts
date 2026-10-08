type ShopSelection = { avatar: string | null; items: readonly { id: string; owned: boolean }[] };

/** The default penguin needs no account or inventory. An unowned or stale selection never appears as an owned friend. */
export function selectedCompanion(shop: ShopSelection | undefined): string | null {
  const avatar = shop?.avatar;
  return avatar && shop.items.some((item) => item.id === avatar && item.owned) ? avatar : null;
}
