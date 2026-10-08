import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const shop = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');
const collection = readFileSync(fileURLToPath(new URL('../coin-collection/index.tsx', import.meta.url)), 'utf8');
const shopRoute = readFileSync(fileURLToPath(new URL('../../app/coin-shop.tsx', import.meta.url)), 'utf8');
const collectionRoute = readFileSync(fileURLToPath(new URL('../../app/coin-collection.tsx', import.meta.url)), 'utf8');

test('사용 전 시작한 조회는 뽑기권 사용 성공 후 화면 상태를 덮지 못한다', async () => {
  const loadSource = shop.slice(shop.indexOf('const load = useCallback('), shop.indexOf('const recover ='));
  const useSource = shop.slice(shop.indexOf('async function openCoinTicket('), shop.indexOf('  const resultReceiptId'))
    .replace('ticketId: string', 'ticketId');
  assert.match(useSource, /loadGeneration\.current \+= 1/);
  let finishGet: (value: unknown) => void = () => {};
  const old = { pools: [], tickets: [{ id: 'ticket-1', status: 'UNUSED' }] };
  type ShopView = typeof old;
  const used = { id: 'ticket-1', status: 'USED' };
  let visible = old;
  let loading = false;
  let gets = 0;
  const deps = {
    useCallback: (fn: unknown) => fn,
    loadGeneration: { current: 0 }, focusEpoch: { current: 1 }, current: { current: true }, inFlight: { current: false },
    shop: { tickets: old.tickets, pools: [] },
    api: { getShop: () => ++gets === 1 ? new Promise((resolve) => { finishGet = resolve; }) : Promise.resolve({ pools: [], tickets: [used] }), useTicket: async () => ({ ticket: used, coin: { id: 'coin-1', summary: {} }, replayed: false }) },
    AsyncStorage: { setItem: async () => {}, removeItem: async () => {} }, ticketUseKey: 'pending',
    setShop: (change: ShopView | ((previous: ShopView) => ShopView)) => { visible = typeof change === 'function' ? change(visible) : change; },
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
  await new Promise(setImmediate);
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
  assert.match(shop, /sortCoinEntries\(pool\.entries\)\.map/);
  assert.match(shop, /coinEntryLabel\(entry\)/);
  assert.equal((shop.match(/entry\.probability \* 100/g) ?? []).length, 1);
  assert.match(shop, /pool\.id === used\.ticket\.poolId \? \{ \.\.\.pool, entries: \[\] \}/);
  assert.match(shop, /disabled=\{busy \|\| result !== undefined \|\| Boolean\(pendingTicketId\) \|\| !canUse\}/);
  assert.match(shop, /기존 보유 코인은 그대로 유지돼요/);
  assert.match(shop, /parseCollectibleArtwork\(result\.summary\)/);
  assert.match(shop, /sourceLabel=\{resultSourceLabel\}/);
  assert.match(shop, /publicationId: result\.publicationId, gradeId: result\.gradeId, receiptId: resultTicketId \?\? ''/);
});

test('expired tickets leave the active locker but remain in its record', () => {
  assert.match(shop, /ticket\.status === 'UNUSED' && Date\.parse\(ticket\.expiresAt\) > now/);
  assert.match(shop, /setTimeout\(\(\) => setNow\(Date\.now\(\)\), Math\.max\(0, nextExpiry - Date\.now\(\)\)\)/);
  assert.match(shop, /<Fold title="사용·만료된 뽑기권 기록">/);
  assert.match(shop, /ticket\.status === 'USED' \? '사용 완료' : '만료'/);
});

test('switching accounts remounts the shop so a prior account’s odds cannot linger', () => {
  assert.match(shopRoute, /<CoinShopScreen key=\{auth\.accountId\}/);
  assert.match(collectionRoute, /<CoinCollectionScreen key=\{auth\.accountId\}/);
});

test('masked reroll odds do not prevent using an owned coin and reroll ticket', () => {
  assert.match(collection, /option\.entries\.length \? sortCoinEntries\(option\.entries\)\.map/);
  assert.match(collection, /coinEntryLabel\(entry\)/);
  assert.match(collection, /현재 확률은 해당 가게의 유효한 미사용 뽑기권 보유자에게만 공개돼요/);
  assert.match(collection, /selectedOption && confirmReroll \? <View onLayout=.*?><FloatingCard/);
  assert.doesNotMatch(collection, /disabled=\{[^}]*option\.entries\.length/);
  assert.match(collection, /options: maskRerollOdds\(old\.reroll\.options, Date\.now\(\), true\)/);
  assert.match(collection, /setTimeout\(\(\) => \{[\s\S]*?options: maskRerollOdds\(old\.reroll\.options, Date\.now\(\)\)/);
  assert.match(collection, /const generation = \+\+loadGeneration\.current;[\s\S]*?loadGeneration\.current === generation/);
});

test('reroll rows use pool and grade together for React identity and selection', () => {
  assert.match(collection, /key=\{`\$\{option\.poolId\}:\$\{option\.grade\}`\}/);
  assert.equal((collection.match(/sameRerollOption\(selectedOption, option\)/g) ?? []).length, 2);
});

test('ticket confirmation and result are scrolled into view after a lower ticket is tapped', () => {
  assert.match(shop, /if \(!confirmTicket && !result\) return;/);
  assert.match(shop, /requestAnimationFrame\(\(\) => scrollView\.current\?\.scrollTo\(\{ y: 0, animated: true \}\)\)/);
  assert.match(shop, /<SkyScrollView ref=\{scrollView\}/);
});

test('reroll confirmation and acquired result scroll to their measured panel instead of the page end', () => {
  assert.match(collection, /<SkyScrollView header=\{<BackHeader title="내 코인·시리즈" \/>\}[\s\S]*?ref=\{scrollRef\}/);
  assert.match(collection, /onHeaderLayout=\{\(height\) => \{ headerHeight\.current = height; \}\}/);
  assert.match(collection, /selectedOption && confirmReroll \? <View onLayout=\{\(event\) => \{ scrollToPanel\(event\.nativeEvent\.layout\.y\); \}\}/);
  assert.match(collection, /rerollResult \? <View onLayout=\{\(event\) => \{[\s\S]*?scrollToPanel\(event\.nativeEvent\.layout\.y\)/);
  assert.match(collection, /headerHeight\.current \+ y - insets\.top - 8/);
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
