import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const shop = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');
const collection = readFileSync(fileURLToPath(new URL('../coin-collection/index.tsx', import.meta.url)), 'utf8');

test('사용 전 시작한 조회는 뽑기권 사용 성공 후 화면 상태를 덮지 못한다', async () => {
  const loadSource = shop.slice(shop.indexOf('const load = useCallback('), shop.indexOf('const recover ='));
  const useSource = shop.slice(shop.indexOf('async function openCoinTicket('), shop.indexOf('return <SkyBackdrop>'))
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
    loadGeneration: { current: 0 }, current: { current: true }, inFlight: { current: false },
    api: { getShop: () => new Promise((resolve) => { finishGet = resolve; }), useTicket: async () => ({ ticket: used, coin: { id: 'coin-1' } }) },
    AsyncStorage: { setItem: async () => {}, removeItem: async () => {} }, ticketUseKey: 'pending',
    setShop: (change: (previous: ShopView) => ShopView) => { visible = change(visible); },
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
  assert.equal(visible.tickets[0]?.status, 'USED');
  assert.equal(loading, false);
});

test('a received ticket discloses its own merchant and exact pool probabilities before use', () => {
  assert.match(shop, /shop\.pools\.find\(\(candidate\) => candidate\.id === ticket\.poolId\)/);
  assert.match(shop, /pool\.entries\.map/);
  assert.equal((shop.match(/coinProbabilityText\(entry\.weight, totalWeight\)/g) ?? []).length, 2);
  assert.match(shop, /disabled=\{busy \|\| result !== undefined \|\| Boolean\(pendingTicketId\) \|\| !canUse\}/);
  assert.match(shop, /기존 보유 코인은 그대로 유지돼요/);
  assert.match(shop, /parseCollectibleArtwork\(result\.summary\)/);
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
