import type { CollectionSnapshot } from '@/commerce/commerce-api';

export type TownCollectionStatus = 'signedOut' | 'loading' | 'ready' | 'error';

export type TownCollectionState = {
  collection: CollectionSnapshot | undefined;
  /** Never 'signedOut': that is the absence of an account, decided by the hook. */
  status: Exclude<TownCollectionStatus, 'signedOut'>;
  /** True when a reload failed over stamps that are still on screen: they may be out of date. */
  stale: boolean;
};

export type TownCollectionEvent =
  | { type: 'accountChanged' }
  | { type: 'loaded'; collection: CollectionSnapshot }
  | { type: 'failed' }
  /** A person's retry or pull-to-refresh starts. */
  | { type: 'retry' };

export const INITIAL_TOWN_COLLECTION: TownCollectionState = { collection: undefined, status: 'loading', stale: false };

/**
 * How the map's stamps follow their loads. Stamps already on screen are never thrown away by a failure: they stay, flagged
 * `stale`, until a load succeeds. Only a load that fails with nothing to show is an error.
 */
export function townCollectionReducer(state: TownCollectionState, event: TownCollectionEvent): TownCollectionState {
  switch (event.type) {
    case 'accountChanged':
      return INITIAL_TOWN_COLLECTION;
    case 'loaded':
      return { collection: event.collection, status: 'ready', stale: false };
    case 'failed':
      if (state.collection === undefined) return { collection: undefined, status: 'error', stale: false };
      return state.stale ? state : { collection: state.collection, status: 'ready', stale: true };
    case 'retry':
      // An earlier failure shows "checking" again while it loads; shown stamps stay as they are.
      return state.status === 'error' ? { ...state, status: 'loading' } : state;
  }
}
