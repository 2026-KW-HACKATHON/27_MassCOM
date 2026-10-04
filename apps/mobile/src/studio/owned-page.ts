export const ownedPageSize = 24;

export function ownedPage<T>(owned: readonly T[], requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(owned.length / ownedPageSize));
  const page = Math.max(0, Math.min(Math.floor(requestedPage), totalPages - 1));
  return {
    items: owned.slice(page * ownedPageSize, (page + 1) * ownedPageSize), page, totalPages,
    hasPrevious: page > 0, hasNext: page + 1 < totalPages,
  };
}
