const retiredMerchantIds = new Set([
  'showcase-local-merchant',
  'showcase-local-merchant-b',
  'showcase-local-merchant-c',
]);

export function visibleHomeMerchantItems<T extends { merchantId: string }>(items: readonly T[], packageId: string | null | undefined): readonly T[] {
  return packageId === 'kr.masscom.wolgye.demo'
    ? items.filter((item) => !retiredMerchantIds.has(item.merchantId))
    : items;
}
