import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BadgeApiError, createBadgeApiClient, parseBadgeBook, parseOpenedReward } from './badge-api';

function couponFixture(overrides: Record<string, unknown> = {}) {
  return {
    couponId: 'coupon-1', milestone: 1, merchantId: 'm-a', merchantName: '가상 점포 A',
    title: '체험 음료 1잔', detail: '음료 1잔', status: 'ISSUED',
    issuedAt: '2026-09-29T01:00:00.000Z', expiresAt: '2026-10-29T01:00:00.000Z', redeemedAt: null,
    ...overrides,
  };
}

function bookFixture() {
  return {
    medals: [
      { kind: 'explorer', value: 2, tier: 2, thresholds: [1, 2, 3] },
      { kind: 'regular', value: 1, tier: 0, thresholds: [2, 3, 5] },
      { kind: 'steady', value: 2, tier: 1, thresholds: [2, 4, 7] },
    ],
    earnedTiers: 3,
    rewards: [
      { milestone: 1, requiredTiers: 3, state: 'OPENED', offer: null, coupon: couponFixture() },
      {
        milestone: 2, requiredTiers: 6, state: 'LOCKED',
        offer: { merchantId: 'm-b', merchantName: '가상 점포 B', title: '체험 디저트', detail: '', validDays: 30 },
        coupon: null,
      },
      { milestone: 3, requiredTiers: 9, state: 'LOCKED', offer: null, coupon: null },
    ],
  };
}

test('parses the §4 badge book and normalises medal and reward order', () => {
  const raw = bookFixture();
  raw.medals.reverse();
  raw.rewards.reverse();
  const book = parseBadgeBook(raw);
  assert.deepEqual(book.medals.map((medal) => medal.kind), ['explorer', 'regular', 'steady']);
  assert.deepEqual(book.rewards.map((reward) => reward.milestone), [1, 2, 3]);
  assert.equal(book.earnedTiers, 3);
  assert.equal(book.rewards[0]?.coupon?.title, '체험 음료 1잔');
  assert.equal(book.rewards[1]?.offer?.merchantName, '가상 점포 B');
});

test('reads the optional unavailableReason only on an UNAVAILABLE box and ignores it elsewhere or when unknown', () => {
  const withReason = (state: string, reason: unknown) => {
    const raw = bookFixture();
    raw.rewards[2] = { milestone: 3, requiredTiers: 9, state, offer: null, coupon: null, unavailableReason: reason } as never;
    return parseBadgeBook(raw).rewards[2]!;
  };
  assert.equal(withReason('UNAVAILABLE', 'COUPON_REVOKED').unavailableReason, 'COUPON_REVOKED');
  // 모르는 값·다른 상태의 값은 무시하고 도감을 거절하지 않는다(필드 자체를 만들지 않는다).
  for (const [state, reason] of [['UNAVAILABLE', 'SOMETHING_NEW'], ['UNAVAILABLE', 7], ['UNAVAILABLE', null],
    ['LOCKED', 'COUPON_REVOKED'], ['READY', 'COUPON_REVOKED']] as const) {
    const reward = withReason(state, reason);
    assert.equal(reward.state, state);
    assert.equal('unavailableReason' in reward, false, `${state} ${String(reason)}`);
  }
  // 옛 서버의 응답(필드 없음)은 그대로 받는다.
  assert.equal('unavailableReason' in parseBadgeBook(bookFixture()).rewards[2]!, false);
});

test('rejects malformed badge books instead of showing guessed progress', () => {
  const cases: [string, (raw: ReturnType<typeof bookFixture>) => void][] = [
    ['missing medal', (raw) => { raw.medals.pop(); }],
    ['duplicate medal kind', (raw) => { raw.medals[2]!.kind = 'explorer'; }],
    ['unknown kind', (raw) => { raw.medals[0]!.kind = 'secret'; }],
    ['tier inconsistent with thresholds', (raw) => { raw.medals[1]!.tier = 1; }],
    ['negative value', (raw) => { raw.medals[0]!.value = -1; }],
    ['decreasing thresholds', (raw) => { raw.medals[0]!.thresholds = [3, 2, 1]; }],
    ['earnedTiers mismatch', (raw) => { raw.earnedTiers = 9; }],
    ['two rewards', (raw) => { raw.rewards.pop(); }],
    ['duplicate milestone', (raw) => { raw.rewards[2]!.milestone = 2; }],
    ['unknown state', (raw) => { raw.rewards[2]!.state = 'MAYBE'; }],
    ['opened without coupon', (raw) => { raw.rewards[0]!.coupon = null; }],
    ['coupon without opened state', (raw) => { raw.rewards[0]!.state = 'READY'; }],
    ['coupon from another box', (raw) => { raw.rewards[0]!.coupon = couponFixture({ milestone: 2 }); }],
    ['redeemed without timestamp', (raw) => { raw.rewards[0]!.coupon = couponFixture({ status: 'REDEEMED' }); }],
    ['issued with redeem timestamp', (raw) => { raw.rewards[0]!.coupon = couponFixture({ redeemedAt: '2026-09-29T02:00:00.000Z' }); }],
    ['bad expiry', (raw) => { raw.rewards[0]!.coupon = couponFixture({ expiresAt: 'soon' }); }],
    ['offer valid days out of range', (raw) => { raw.rewards[1]!.offer!.validDays = 0; }],
    ['offer missing merchant', (raw) => { raw.rewards[1]!.offer!.merchantName = ' '; }],
    ['non-increasing required tiers', (raw) => { raw.rewards[2]!.requiredTiers = 6; }],
  ];
  for (const [label, mutate] of cases) {
    const raw = bookFixture();
    mutate(raw);
    assert.throws(() => parseBadgeBook(raw), (error: unknown) =>
      error instanceof BadgeApiError && error.code === 'INVALID_RESPONSE', label);
  }
  assert.throws(() => parseBadgeBook(null), BadgeApiError);
  assert.throws(() => parseBadgeBook({ medals: {}, rewards: [] }), BadgeApiError);
});

test('accepts redeemed and expired coupons with matching timestamps', () => {
  const raw = bookFixture();
  raw.rewards[0]!.coupon = couponFixture({ status: 'REDEEMED', redeemedAt: '2026-09-30T02:00:00.000Z' });
  assert.equal(parseBadgeBook(raw).rewards[0]?.coupon?.status, 'REDEEMED');
  raw.rewards[0]!.coupon = couponFixture({ status: 'EXPIRED' });
  assert.equal(parseBadgeBook(raw).rewards[0]?.coupon?.status, 'EXPIRED');
});

test('accepts a voided coupon and keeps it distinct from redeemed and expired ones', () => {
  const raw = bookFixture();
  raw.rewards[0]!.coupon = couponFixture({ status: 'VOIDED' });
  assert.equal(parseBadgeBook(raw).rewards[0]?.coupon?.status, 'VOIDED');
  // 무효 쿠폰에는 사용 시각이 있으면 안 된다(사용 시각은 사용 완료에만 붙는다).
  raw.rewards[0]!.coupon = couponFixture({ status: 'VOIDED', redeemedAt: '2026-09-30T02:00:00.000Z' });
  assert.throws(() => parseBadgeBook(raw), BadgeApiError);
  raw.rewards[0]!.coupon = couponFixture({ status: 'VOIDED_BY_ADMIN' });
  assert.throws(() => parseBadgeBook(raw), BadgeApiError);
});

test('gets the badge book with the account credential and no query string', async () => {
  const client = createBadgeApiClient({
    apiUrl: 'https://api.example.test/',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      assert.equal(String(input), 'https://api.example.test/me/badges');
      assert.equal(init?.method, undefined);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer session');
      return Response.json(bookFixture());
    },
  });
  assert.equal((await client.getBadgeBook()).earnedTiers, 3);
});

test('opens a reward box with an empty JSON body and checks the returned milestone', async () => {
  const bodies: unknown[] = [];
  const client = createBadgeApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'demo', accountId: 'customer-1', allowInsecureReauthentication: false },
    fetcher: async (input, init) => {
      assert.equal(String(input), 'https://api.example.test/me/badges/rewards/1/open');
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('x-account-id'), 'customer-1');
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ coupon: couponFixture(), replayed: bodies.length > 1 });
    },
  });
  assert.equal((await client.openReward(1)).replayed, false);
  assert.equal((await client.openReward(1)).replayed, true);
  assert.deepEqual(bodies, [{}, {}]);
  assert.throws(() => parseOpenedReward({ coupon: couponFixture(), replayed: false }, 2), BadgeApiError);
  assert.throws(() => parseOpenedReward({ coupon: couponFixture() }, 1), BadgeApiError);
  await assert.rejects(client.openReward(4 as 1), (error: unknown) =>
    error instanceof BadgeApiError && error.code === 'INVALID_REQUEST');
});

test('maps reward errors to codes and invalidates only an expired bearer session', async () => {
  let invalidated = 0;
  const responses = [
    Response.json({ code: 'REWARD_LOCKED' }, { status: 409 }),
    Response.json({ code: 'SESSION_INVALID' }, { status: 401 }),
    new Response('<html>bad gateway</html>', { status: 502 }),
  ];
  const client = createBadgeApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    onSessionInvalid: () => { invalidated += 1; },
    fetcher: async () => responses.shift()!,
  });
  await assert.rejects(client.openReward(2), (error: unknown) =>
    error instanceof BadgeApiError && error.status === 409 && error.code === 'REWARD_LOCKED');
  await assert.rejects(client.getBadgeBook(), (error: unknown) =>
    error instanceof BadgeApiError && error.code === 'SESSION_INVALID');
  await assert.rejects(client.getBadgeBook(), (error: unknown) =>
    error instanceof BadgeApiError && error.code === 'HTTP_502');
  assert.equal(invalidated, 1);
});

test('rejects a successful response that is not JSON', async () => {
  const client = createBadgeApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => new Response('ok', { status: 200 }),
  });
  await assert.rejects(client.getBadgeBook(), (error: unknown) =>
    error instanceof BadgeApiError && error.code === 'INVALID_RESPONSE');
});
