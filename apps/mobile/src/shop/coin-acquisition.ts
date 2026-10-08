export type CoinAcquisitionKey = { publicationId: string; gradeId: string };

export type CoinAcquisitionStatus = 'new' | 'duplicate' | 'owned';

export type CoinAcquisitionSnapshot = ReadonlyMap<string, number>;

export function coinAcquisitionKey(value: CoinAcquisitionKey): string {
  return `${value.publicationId}:${value.gradeId}`;
}

export function snapshotCoinQuantities(coins: readonly (CoinAcquisitionKey & { quantity: number })[]): CoinAcquisitionSnapshot {
  return new Map(coins.map((coin) => [coinAcquisitionKey(coin), coin.quantity]));
}

export function coinWasOwned(snapshot: CoinAcquisitionSnapshot | undefined, coin: CoinAcquisitionKey): boolean | undefined {
  if (!snapshot) return undefined;
  return (snapshot.get(coinAcquisitionKey(coin)) ?? 0) > 0;
}

export function classifyTicketCoinAcquisition(input: {
  coin: CoinAcquisitionKey & { quantity: number };
  replayed: boolean;
  before?: CoinAcquisitionSnapshot;
}): CoinAcquisitionStatus {
  if (input.replayed) return 'owned';
  const ownedBefore = coinWasOwned(input.before, input.coin);
  if (ownedBefore !== undefined) return ownedBefore ? 'duplicate' : 'new';
  return input.coin.quantity === 1 ? 'new' : 'duplicate';
}

export function classifyRerollCoinAcquisition(input: {
  coin: CoinAcquisitionKey & { quantity: number };
  consumed: CoinAcquisitionKey;
  replayed: boolean;
  before?: CoinAcquisitionSnapshot;
}): CoinAcquisitionStatus {
  if (input.replayed) return 'owned';
  if (coinAcquisitionKey(input.coin) === coinAcquisitionKey(input.consumed)) return 'owned';
  const ownedBefore = coinWasOwned(input.before, input.coin);
  if (ownedBefore === false) return 'new';
  if (ownedBefore === true) return 'duplicate';
  return 'owned';
}

export function classifyGradeDrawCoinAcquisition(input: {
  duplicate: boolean;
  replayed: boolean;
}): CoinAcquisitionStatus {
  if (input.replayed) return 'owned';
  return input.duplicate ? 'duplicate' : 'new';
}
