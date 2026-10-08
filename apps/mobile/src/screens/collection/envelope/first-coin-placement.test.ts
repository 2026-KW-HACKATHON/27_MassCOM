import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defaultStudio, StudioApiError } from '@/studio/studio-api';
import { firstCoinStudio, isClearlyNotFirst, isFirstCollectible, isStudioVersionConflict, placeFirstCoin, readFirstCoinOffer, resolveSaveConflict, shouldOfferFirstCoinPlacement, type FirstCoinPlacementInput } from './first-coin-placement';

const fresh: FirstCoinPlacementInput = {
  batchIds: ['e1'], collectibles: [{ entitlementId: 'e1' }], visibility: 'PRIVATE',
  room: { studio: { slots: [], coinSlots: [], furniture: [] }, revision: 0 },
};

test('the very first coin into a never-saved private room is offered', () => {
  assert.equal(shouldOfferFirstCoinPlacement(fresh), true);
  assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, room: { studio: { slots: [], furniture: [] }, revision: 0 } }), true, 'coinSlots absent counts as empty');
});

test('a second coin is not a first coin, however empty the room is', () => {
  assert.equal(isFirstCollectible(['e1'], [{ entitlementId: 'e1' }, { entitlementId: 'old' }]), false);
  assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, collectibles: [{ entitlementId: 'e1' }, { entitlementId: 'old' }] }), false);
  assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, collectibles: [] }), false, 'an empty collection cannot confirm the coin arrived');
  assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, batchIds: [] }), false);
});

test('an envelope with several first cards still counts when they are all the account holds', () => {
  assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, batchIds: ['e1', 'e2'], collectibles: [{ entitlementId: 'e1' }, { entitlementId: 'e2' }] }), true);
});

test('a room that was ever saved, or already shows something, is left alone', () => {
  assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, room: { ...fresh.room!, revision: 1 } }), false);
  assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, room: { studio: { slots: ['x'], coinSlots: [], furniture: [] }, revision: 0 } }), false);
  assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, room: { studio: { slots: [], coinSlots: [{ sourceKind: 'VISIT', sourceId: 'v' }], furniture: [] }, revision: 0 } }), false);
  assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, room: { studio: { slots: [], coinSlots: [], furniture: [{ inventoryId: 'f', x: 0, y: 0, rotation: 0 }] }, revision: 0 } }), false);
});

test('unknown revision, unreadable room or any visibility but private never offers (saving must not publish)', () => {
  assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, room: null }), false);
  assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, room: { studio: fresh.room!.studio } }), false, 'revision missing is not revision 0');
  for (const visibility of [null, 'FRIENDS', 'NEIGHBORS'] as const) assert.equal(shouldOfferFirstCoinPlacement({ ...fresh, visibility }), false, String(visibility));
});

test('placing keeps the person\'s room settings and only puts the one coin on the shelf', () => {
  const placed = firstCoinStudio({ ...defaultStudio, theme: 'garden', accent: 'rose' }, 'e1');
  assert.deepEqual(placed.slots, ['e1']);
  assert.deepEqual([placed.theme, placed.accent, placed.layout, placed.furniture], ['garden', 'rose', 'shelf', []]);
  assert.deepEqual(defaultStudio.slots, [], 'the shared default is not mutated');
});

test('only a version conflict from the studio API is treated as a conflict', () => {
  assert.equal(isStudioVersionConflict(new StudioApiError(409, 'STUDIO_VERSION_CONFLICT')), true);
  assert.equal(isStudioVersionConflict(new StudioApiError(409, 'STUDIO_ITEM_NOT_OWNED')), false);
  assert.equal(isStudioVersionConflict(new Error('STUDIO_VERSION_CONFLICT')), false);
});

test('the offer never writes visibility: only the studio save is called, with the snapshot revision, and no room-publication setter exists in either file', () => {
  const component = readFileSync(new URL('./first-coin-offer.tsx', import.meta.url), 'utf8');
  const module = readFileSync(new URL('./first-coin-placement.ts', import.meta.url), 'utf8');
  assert.match(component, /placeFirstCoin\(\{/);
  assert.match(component, /save: clients\.studio\.save/);
  assert.match(module, /deps\.save\(firstCoinStudio\(snapshot\.studio, entitlementId\), snapshot\.revision\)/);
  assert.doesNotMatch(component + module, /setVisibility|room-publication/);
});

const emptyRoom = { studio: { slots: [] as string[], coinSlots: [] as never[], furniture: [] as never[] }, revision: 0 };
const reads = (collection: () => Promise<{ collectibles: readonly { entitlementId: string }[] }>) => ({
  studio: async () => emptyRoom, room: async () => ({ visibility: 'PRIVATE' as const }), collection,
});

test('no offer when the collection read fails, whatever the room looks like', async () => {
  const offer = await readFirstCoinOffer(['e1'], reads(async () => { throw new Error('NETWORK_ERROR'); }));
  assert.equal(offer, null);
});

test('no offer when the collection holds coins other than this envelope\'s, or does not hold this one, or is empty', async () => {
  assert.equal(await readFirstCoinOffer(['e1'], reads(async () => ({ collectibles: [{ entitlementId: 'e1' }, { entitlementId: 'older' }] }))), null);
  assert.equal(await readFirstCoinOffer(['e1'], reads(async () => ({ collectibles: [{ entitlementId: 'older' }] }))), null);
  assert.equal(await readFirstCoinOffer(['e1'], reads(async () => ({ collectibles: [] }))), null);
});

test('a failed studio or room read also means no offer, and a clean first coin is the only thing that passes', async () => {
  const good = async () => ({ collectibles: [{ entitlementId: 'e1' }] });
  assert.equal(await readFirstCoinOffer(['e1'], { ...reads(good), studio: async () => { throw new Error('x'); } }), null);
  assert.equal(await readFirstCoinOffer(['e1'], { ...reads(good), room: async () => { throw new Error('x'); } }), null);
  const offer = await readFirstCoinOffer(['e1'], reads(good));
  assert.deepEqual(offer?.coin, { entitlementId: 'e1' });
  assert.equal(offer?.snapshot.revision, 0);
});

test('the handed-in collection can only skip the reads, and only when it clearly holds a coin from before this envelope', () => {
  assert.equal(isClearlyNotFirst(['e1'], []), false, 'an empty stand-in must not hide a real first coin until the next poll');
  assert.equal(isClearlyNotFirst(['e1'], [{ entitlementId: 'e1' }]), false, 'a subset of the truth cannot hide it either');
  assert.equal(isClearlyNotFirst(['e1', 'e2'], [{ entitlementId: 'e2' }]), false);
  assert.equal(isClearlyNotFirst(['e1'], [{ entitlementId: 'e1' }, { entitlementId: 'older' }]), true);
  const component = readFileSync(new URL('./first-coin-offer.tsx', import.meta.url), 'utf8');
  assert.match(component, /const mayBeFirst = firstId !== undefined && !isClearlyNotFirst\(batchIds, collectibles\);/);
});

test('the offer component decides only through readFirstCoinOffer and keeps one save in flight and a dismissal sticky', () => {
  const component = readFileSync(new URL('./first-coin-offer.tsx', import.meta.url), 'utf8');
  assert.match(component, /readFirstCoinOffer\(batchIds, \{/);
  assert.doesNotMatch(component, /shouldOfferFirstCoinPlacement/);
  assert.match(component, /const inFlight = useRef\(false\);\s*const dismissed = useRef\(false\);/);
  assert.match(component, /if \(inFlight\.current \|\| saving\) return;\s*inFlight\.current = true;/);
  assert.match(component, /if \(!alive \|\| !offer \|\| dismissed\.current \|\| inFlight\.current\) return;/);
  assert.match(component, /const later = \(\) => \{ dismissed\.current = true; setPhase\(\{ kind: 'hidden' \}\); \};/);
  assert.match(component, /<View accessibilityLiveRegion="polite" aria-live="polite">/);
});

const privateRoom = { studio: { ...defaultStudio, theme: 'garden' as const }, revision: 0 };
const deps = (patch: Partial<Parameters<typeof placeFirstCoin>[0]> = {}) => {
  const saved: { studio: typeof defaultStudio; revision?: number }[] = [];
  return {
    saved,
    deps: {
      readVisibility: async () => 'PRIVATE' as const,
      save: async (studio: typeof defaultStudio, revision?: number) => { saved.push({ studio, revision }); },
      readStudio: async () => ({ studio: { slots: [] as string[] } }),
      ...patch,
    },
  };
};

test('placing saves the coin once at the offered revision after a fresh private check', async () => {
  const { saved, deps: d } = deps();
  assert.equal(await placeFirstCoin(d, privateRoom, 'e1'), 'placed');
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0]!.studio.slots, saved[0]!.studio.theme, saved[0]!.revision], [['e1'], 'garden', 0]);
});

test('if the room is no longer private right before the save, nothing is saved and the person is told', async () => {
  for (const visibility of ['FRIENDS', 'NEIGHBORS'] as const) {
    const { saved, deps: d } = deps({ readVisibility: async () => visibility });
    assert.equal(await placeFirstCoin(d, privateRoom, 'e1'), 'shared', visibility);
    assert.equal(saved.length, 0, 'a shared room never receives the coin');
  }
  const { saved, deps: d } = deps({ readVisibility: async () => { throw new Error('NETWORK_ERROR'); } });
  assert.deepEqual(await placeFirstCoin(d, privateRoom, 'e1'), { error: new Error('NETWORK_ERROR') });
  assert.equal(saved.length, 0, 'an unreadable visibility is not assumed private');
});

test('a version conflict re-reads the room: the coin already on its shelf is a success, anything else is a conflict', async () => {
  const conflict = async () => { throw new StudioApiError(409, 'STUDIO_VERSION_CONFLICT'); };
  assert.equal(await placeFirstCoin(deps({ save: conflict, readStudio: async () => ({ studio: { slots: ['e1'] } }) }).deps, privateRoom, 'e1'), 'placed');
  assert.equal(await placeFirstCoin(deps({ save: conflict, readStudio: async () => ({ studio: { slots: ['other'] } }) }).deps, privateRoom, 'e1'), 'conflict');
  assert.equal(await placeFirstCoin(deps({ save: conflict, readStudio: async () => { throw new Error('NETWORK_ERROR'); } }).deps, privateRoom, 'e1'), 'conflict');
  assert.equal(await resolveSaveConflict(async () => ({ studio: { slots: ['e1', 'x'] } }), 'e1'), 'placed');
});

test('other save failures come back as errors for the offer to show, and can be retried', async () => {
  const failure = new StudioApiError(500, 'HTTP_500');
  const outcome = await placeFirstCoin(deps({ save: async () => { throw failure; } }).deps, privateRoom, 'e1');
  assert.deepEqual(outcome, { error: failure });
});
