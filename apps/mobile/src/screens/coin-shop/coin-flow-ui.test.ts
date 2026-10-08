import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const shop = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');
const collection = readFileSync(fileURLToPath(new URL('../coin-collection/index.tsx', import.meta.url)), 'utf8');

test('사용 전 시작한 조회는 뽑기권 사용 성공 후 화면 상태를 덮지 못한다', async () => {
  const loadSource = shop.slice(shop.indexOf('const load = useCallback('), shop.indexOf('const recover ='));
  const useSource = shop.slice(shop.indexOf('async function openCoinTicket('), shop.indexOf('  const resultReceiptId'))
    .replace('ticketId: string', 'ticketId');
  assert.match(useSource, /loadGeneration\.current \+= 1/);
  let finishGet: (value: unknown) => void = () => {};
  const old = { tickets: [{ id: 'ticket-1', status: 'UNUSED' }] };
  type ShopView = typeof old;
  const used = { id: 'ticket-1', status: 'USED' };
  let visible = old;
  let loading = false;
  const deps = {
    useCallback: (fn: unknown) => fn,
    loadGeneration: { current: 0 }, focusEpoch: { current: 1 }, current: { current: true }, inFlight: { current: false },
    shop: { tickets: old.tickets, pools: [] },
    api: { getShop: () => new Promise((resolve) => { finishGet = resolve; }), useTicket: async () => ({ ticket: used, coin: { id: 'coin-1' }, replayed: false }) },
    AsyncStorage: { setItem: async () => {}, removeItem: async () => {} }, ticketUseKey: 'pending',
    setShop: (change: (previous: ShopView) => ShopView) => { visible = change(visible); },
    setNow: () => {}, setLoading: (value: boolean) => { loading = value; }, setMessage: () => {}, setBusy: () => {}, setPendingTicketId: () => {},
    setResult: () => {}, setResultTicketId: () => {}, setResultStatus: () => {}, setResultSourceLabel: () => {},
    classifyTicketCoinAcquisition: () => 'new', publicDataDemoStoreName: (_id: string | undefined, name: string) => name,
    coinErrorMessage: () => '', CoinApiError: Error,
  };
  const actions = new Function('deps', `with (deps) { ${loadSource} ${useSource}; return { load, openCoinTicket }; }`)(deps) as
    { load: (showLoading?: boolean) => Promise<void>; openCoinTicket: (id: string) => Promise<void> };
  const staleLoad = actions.load(true);
  assert.equal(loading, true);
  await actions.openCoinTicket('ticket-1');
  finishGet(old);
  await staleLoad;
  assert.equal(visible.tickets[0]?.status, 'USED');
  assert.equal(loading, false);
});


test('focus changes during ticket use cannot reveal an old async result', async () => {
  const useSource = shop.slice(shop.indexOf('async function openCoinTicket('), shop.indexOf('  const resultReceiptId'))
    .replace('ticketId: string', 'ticketId');
  let resultWasShown = false;
  let recoveryWasCleared = false;
  let busy = false;
  const focusEpoch = { current: 1 };
  const deps = {
    loadGeneration: { current: 0 }, focusEpoch, current: { current: true }, inFlight: { current: false },
    shop: { tickets: [{ id: 'ticket-1', poolId: 'pool-1', eventName: '행사' }], pools: [{ id: 'pool-1', merchantId: 'm1', merchantName: '가게', eventName: '행사' }] },
    api: { useTicket: async () => { focusEpoch.current = 2; return { ticket: { id: 'ticket-1', status: 'USED' }, coin: { id: 'coin-1' }, replayed: false }; } },
    AsyncStorage: { setItem: async () => {}, removeItem: async () => { recoveryWasCleared = true; } }, ticketUseKey: 'pending',
    setBusy: (value: boolean) => { busy = value; }, setMessage: () => {}, setPendingTicketId: () => {}, setLoading: () => {}, setShop: () => {},
    setResult: () => { resultWasShown = true; }, setResultTicketId: () => {}, setResultStatus: () => {}, setResultSourceLabel: () => {}, load: async () => {},
    classifyTicketCoinAcquisition: () => 'new', publicDataDemoStoreName: (_id: string | undefined, name: string) => name,
    coinErrorMessage: () => '', CoinApiError: Error,
  };
  const actions = new Function('deps', `with (deps) { ${useSource}; return { openCoinTicket }; }`)(deps) as
    { openCoinTicket: (id: string) => Promise<void> };
  await actions.openCoinTicket('ticket-1');
  assert.equal(resultWasShown, false);
  assert.equal(recoveryWasCleared, false, 'a consumed ticket must remain recoverable when focus changes before its result arrives');
  assert.equal(busy, false, 'the refocused screen must allow the retained request to be recovered');
});

test('a successful reroll that returns after refocus keeps its durable recovery marker', async () => {
  const rerollSource = collection.slice(collection.indexOf('async function performReroll('), collection.indexOf('  const rerollReceiptId'))
    .replace('saved?: CoinRerollPending', 'saved');
  const focusEpoch = { current: 1 };
  const attempt = { ticketId: 'ticket-1', source: { publicationId: 'old', gradeId: 'gold' }, poolId: 'pool-1', requestId: 'request-1' };
  let cleared = false;
  let shown = false;
  let busyId: string | undefined;
  const deps = {
    focusEpoch, current: { current: true }, inFlight: { current: false }, pendingKey: 'reroll-pending',
    startOrResumeCoinReroll: async () => attempt,
    clearCoinRerollPending: async () => { cleared = true; },
    api: { reroll: async () => { focusEpoch.current = 2; return { coin: { publicationId: 'new', gradeId: 'gold' }, rerollId: 'result-1', replayed: false }; } },
    setBusyId: (value: string | undefined) => { busyId = value; }, setMessage: () => {}, setRerollPending: () => {},
    setRerollResult: () => { shown = true; }, setRerollResultId: () => {}, setRerollResultStatus: () => {},
    setRegistrationOpen: () => {}, setConfirmReroll: () => {}, setSelectedSource: () => {}, setSelectedOption: () => {},
    load: async () => {}, finalRerollFailure: () => false, coinErrorMessage: () => '',
    classifyRerollCoinAcquisition: () => 'owned',
  };
  const perform = new Function('deps', `with (deps) { ${rerollSource}; return performReroll; }`)(deps) as (saved: unknown) => Promise<void>;
  await perform(attempt);
  assert.equal(shown, false);
  assert.equal(cleared, false, 'the authoritative result must be replayable on the next focus');
  assert.equal(busyId, undefined, 'the refocused screen must enable the retained reroll retry');
});

test('coin collection focus and registration state are derived from current collection data', () => {
  assert.match(collection, /const generation = \+\+loadGeneration\.current/);
  assert.match(collection, /focusEpoch\.current === epoch && loadGeneration\.current === generation/);
  assert.match(collection, /merchantOffsets\.current\.get\(merchantId\)/);
  assert.match(collection, /merchantY \+ typeY \+ rowY \+ gradeY - 24/);
  assert.match(collection, /animated: motionEnabled/);
  assert.match(collection, /useMotionEnabled\(\)/);
  assert.match(collection, /const rerollCanRegister = Boolean\(rerollResult && collection\?\.coins\.some/);
  assert.doesNotMatch(collection, /setRerollCanRegister/);
  assert.match(collection, /const rerollRegistrationStatus = rerollReceiptId && settledRegistrationReceiptId === rerollReceiptId \? 'owned' : rerollResultStatus/);
  assert.match(shop, /const resultRegistrationStatus = resultReceiptId && settledRegistrationReceiptId === resultReceiptId \? 'owned' : resultStatus/);
});


test('a received ticket discloses its own merchant and exact pool probabilities before use', () => {
  assert.match(shop, /shop\.pools\.find\(\(candidate\) => candidate\.id === ticket\.poolId\)/);
  assert.match(shop, /pool\.entries\.map/);
  assert.equal((shop.match(/coinProbabilityText\(entry\.weight, totalWeight\)/g) ?? []).length, 2);
  assert.match(shop, /disabled=\{busy \|\| result !== undefined \|\| Boolean\(pendingTicketId\) \|\| !canUse\}/);
  assert.match(shop, /기존 보유 코인은 그대로 유지돼요/);
  assert.match(shop, /parseCollectibleArtwork\(result\.summary\)/);
  assert.match(shop, /sourceLabel=\{resultSourceLabel\}/);
  assert.match(shop, /publicationId: result\.publicationId, gradeId: result\.gradeId, receiptId: resultTicketId \?\? ''/);
});

test('a base series coupon requires an explicit choice after the one-claim consequence is shown', () => {
  assert.match(collection, /시리즈당 쿠폰 1회 · 기본 수령 후 프리즘으로 변경하거나 추가 발급할 수 없어요/);
  assert.doesNotMatch(collection, /Alert\.alert/);
  assert.match(collection, /confirmingBaseFor === series\.id && series\.claimable === 'BASE' && !series\.coupon/);
  assert.match(collection, /기본 쿠폰을 지금 받을까요\?/);
  assert.match(collection, /onPress=\{\(\) => setConfirmingBaseFor\(undefined\)\}/);
  assert.match(collection, /onPress=\{onClaim\}/);
  assert.match(collection, /disabled=\{busy\}/);
});
