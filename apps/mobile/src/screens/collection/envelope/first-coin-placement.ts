import type { RoomVisibility } from '@/studio/room-api';
import { StudioApiError, type Studio } from '@/studio/studio-api';

/** The account holds nothing but what this envelope delivered. */
export function isFirstCollectible(batchIds: readonly string[], collectibles: readonly { entitlementId: string }[]): boolean {
  return batchIds.length > 0 && collectibles.length > 0 && collectibles.every((item) => batchIds.includes(item.entitlementId));
}

/**
 * Cheap pre-filter on a collection the reveal screen was handed, which may be a stand-in or empty. It can only skip the server reads,
 * and only when it is non-empty and holds a coin from outside this envelope; empty or unsure means ask the server.
 */
export const isClearlyNotFirst = (batchIds: readonly string[], collectibles: readonly { entitlementId: string }[]): boolean =>
  collectibles.some((item) => !batchIds.includes(item.entitlementId));

export type FirstCoinPlacementInput = {
  /** Entitlements in the envelope that actually opened. */
  batchIds: readonly string[];
  /** The account's collection as the server reports it now. */
  collectibles: readonly { entitlementId: string }[];
  /** The account's saved room as the server reports it now; null when it could not be read. */
  room: { studio: Pick<Studio, 'slots' | 'coinSlots' | 'furniture'>; revision?: number } | null;
  /** The room's current visibility; null when it could not be read. */
  visibility: RoomVisibility | null;
};

/**
 * Offer "첫 코인을 내 공간에 놓아볼까요?" only at a person's very first coin, into a room they have never saved (revision 0, no
 * coin on show, nothing placed) that nobody else can see. A room that is already shared is never offered: saving into it would
 * publish the new coin without the separate consent. Anything unknown (revision, visibility) means no offer.
 */
export function shouldOfferFirstCoinPlacement(input: FirstCoinPlacementInput): boolean {
  const { room, visibility } = input;
  if (!room || visibility !== 'PRIVATE' || room.revision !== 0) return false;
  if (room.studio.slots.length > 0 || (room.studio.coinSlots?.length ?? 0) > 0 || room.studio.furniture.length > 0) return false;
  return isFirstCollectible(input.batchIds, input.collectibles);
}

/** The room as it will be saved: the person's own settings with the one coin on the shelf. Visibility is not part of a studio. */
export function firstCoinStudio(studio: Studio, entitlementId: string): Studio {
  return { ...studio, slots: [entitlementId] };
}

/** Another device saved the room between the check and the save. */
export const isStudioVersionConflict = (error: unknown): boolean => error instanceof StudioApiError && error.code === 'STUDIO_VERSION_CONFLICT';

export type FirstCoinReads<S extends FirstCoinPlacementInput['room'] & object, C extends { entitlementId: string }> = {
  studio: () => Promise<S>;
  room: () => Promise<{ visibility: RoomVisibility }>;
  collection: () => Promise<{ collectibles: readonly C[] }>;
};

/**
 * The only way an offer comes into being: three fresh server reads, all of which must succeed. A failed or empty collection read,
 * a collection holding coins from before this envelope, or a collection that lacks this envelope's coin all mean no offer.
 * Whatever collection the reveal screen was handed (it may be a stand-in) is never consulted here; it can only skip the reads.
 */
export async function readFirstCoinOffer<S extends NonNullable<FirstCoinPlacementInput['room']>, C extends { entitlementId: string }>(
  batchIds: readonly string[], reads: FirstCoinReads<S, C>,
): Promise<{ snapshot: S; coin: C } | null> {
  try {
    const [snapshot, settings, collection] = await Promise.all([reads.studio(), reads.room(), reads.collection()]);
    const coin = collection.collectibles.find((item) => item.entitlementId === batchIds[0]);
    return coin && shouldOfferFirstCoinPlacement({ batchIds, collectibles: collection.collectibles, room: snapshot, visibility: settings.visibility })
      ? { snapshot, coin } : null;
  } catch {
    return null;
  }
}

export type PlaceOutcome = 'placed' | 'shared' | 'conflict' | { error: unknown };

/** Someone else saved the room first: if the coin already sits on its shelf the goal is met, otherwise say the room changed. */
export async function resolveSaveConflict(readStudio: () => Promise<{ studio: Pick<Studio, 'slots'> }>, entitlementId: string): Promise<'placed' | 'conflict'> {
  try {
    return (await readStudio()).studio.slots.includes(entitlementId) ? 'placed' : 'conflict';
  } catch {
    return 'conflict';
  }
}

/**
 * Saves the first coin, but only while the room is still private (read again right before the write, so "나만 보여요" stays true) and
 * with the revision the offer was made at. A version conflict is resolved by re-reading the room. Nothing here writes visibility.
 */
export async function placeFirstCoin(
  deps: {
    readVisibility: () => Promise<RoomVisibility>;
    save: (studio: Studio, expectedRevision?: number) => Promise<unknown>;
    readStudio: () => Promise<{ studio: Pick<Studio, 'slots'> }>;
  },
  snapshot: { studio: Studio; revision?: number },
  entitlementId: string,
): Promise<PlaceOutcome> {
  try {
    if ((await deps.readVisibility()) !== 'PRIVATE') return 'shared';
    await deps.save(firstCoinStudio(snapshot.studio, entitlementId), snapshot.revision);
    return 'placed';
  } catch (error) {
    return isStudioVersionConflict(error) ? resolveSaveConflict(deps.readStudio, entitlementId) : { error };
  }
}
