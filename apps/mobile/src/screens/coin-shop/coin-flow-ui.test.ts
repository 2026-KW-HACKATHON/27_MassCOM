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
  const useSource = shop.slice(shop.indexOf('async function openCoinTicket('), shop.indexOf('return <SkyBackdrop>'))
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
    loadGeneration: { current: 0 }, current: { current: true }, inFlight: { current: false },
    api: { getShop: () => ++gets === 1 ? new Promise((resolve) => { finishGet = resolve; })
      : Promise.resolve({ pools: [], tickets: [used] }), useTicket: async () => ({ ticket: used, coin: { id: 'coin-1', summary: {} } }) },
    AsyncStorage: { setItem: async () => {}, removeItem: async () => {} }, ticketUseKey: 'pending',
    setShop: (change: ShopView | ((previous: ShopView) => ShopView)) => { visible = typeof change === 'function' ? change(visible) : change; },
    setNow: () => {}, setLoading: (value: boolean) => { loading = value; }, setMessage: () => {}, setBusy: () => {}, setPendingTicketId: () => {},
    setResult: () => {}, setResultTicketId: () => {}, coinErrorMessage: () => '', CoinApiError: Error,
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

test('a received ticket discloses live odds while a shop listing does not expose them', () => {
  assert.match(shop, /shop\.pools\.find\(\(candidate\) => candidate\.id === ticket\.poolId\)/);
  assert.match(shop, /pool\.entries\.map/);
  assert.equal((shop.match(/entry\.probability \* 100/g) ?? []).length, 1);
  assert.match(shop, /pool\.id === used\.ticket\.poolId \? \{ \.\.\.pool, entries: \[\] \}/);
  assert.match(shop, /disabled=\{busy \|\| result !== undefined \|\| Boolean\(pendingTicketId\) \|\| !canUse\}/);
  assert.match(shop, /기존 보유 코인은 그대로 유지돼요/);
  assert.match(shop, /parseCollectibleArtwork\(result\.summary\)/);
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
  assert.match(collection, /option\.entries\.length \? option\.entries\.map/);
  assert.match(collection, /현재 확률은 해당 가게의 유효한 미사용 뽑기권 보유자에게만 공개돼요/);
  assert.match(collection, /selectedOption && confirmReroll \? <FloatingCard/);
  assert.doesNotMatch(collection, /disabled=\{[^}]*option\.entries\.length/);
  assert.match(collection, /options: maskRerollOdds\(old\.reroll\.options, Date\.now\(\), true\)/);
  assert.match(collection, /setTimeout\(\(\) => \{[\s\S]*?options: maskRerollOdds\(old\.reroll\.options, Date\.now\(\)\)/);
  assert.match(collection, /const generation = \+\+loadGeneration\.current;[\s\S]*?loadGeneration\.current === generation/);
});

test('reroll rows use pool and grade together for React identity and selection', () => {
  assert.match(collection, /key=\{`\$\{option\.poolId\}:\$\{option\.grade\}`\}/);
  assert.equal((collection.match(/sameRerollOption\(selectedOption, option\)/g) ?? []).length, 2);
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
