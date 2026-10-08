import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { claimCodeMinutes, coinAvailability, conditionSourceLabel, visitConditions } from './visit-conditions';

const business = { state: 'OPEN', basis: 'SCHEDULE', evaluatedAt: '2026-10-06T03:00:00Z', nextChangeAt: null, informationUpdatedAt: null, acceptingOrders: true, lastOrderAt: null } as const;

test('a real store\'s conditions are the six the flow really has, in reading order, each tagged by who enforces it', () => {
  const conditions = visitConditions({ minimumSpendWon: 8000, business, demo: false });
  assert.deepEqual(conditions.map((condition) => [condition.key, condition.source]), [
    ['activeCampaign', 'SERVER_RULE'], ['staffCheck', 'SERVER_RULE'], ['oncePerDay', 'SERVER_RULE'],
    ['minimumSpend', 'STORE_SETTING'], ['openHours', 'STORE_SETTING'], ['codeTtl', 'SERVER_RULE'],
  ]);
  assert.equal(conditions[0]!.text, '진행 중인 캠페인이 있어야 방문이 기록돼요.');
  assert.match(conditions[3]!.text, /8,000원/);
  assert.match(conditions[3]!.text, /앱이 아니라 가게에서 확인/, 'store-set limits are not presented as app rules');
  assert.match(conditions[4]!.text, /영업 중 · 시간표 기준/);
  assert.match(conditions[5]!.text, /15분 안에/);
});

test('a 시연 점포 does not list the staff, once-a-day, spend or hours rules; it says it is tried with 테스트 방문 만들기 and has no staff check', () => {
  const conditions = visitConditions({ minimumSpendWon: 8000, business, demo: true });
  assert.deepEqual(conditions.map((condition) => condition.key), ['demoTest', 'activeCampaign']);
  assert.match(conditions[0]!.text, /"테스트 방문 만들기"/);
  assert.match(conditions[0]!.text, /직원 확인 없이/);
  assert.match(conditions[0]!.text, /하루 한 번 제한은 적용되지 않아요/);
});

test('no minimum spend says so instead of inventing a number, and an unknown opening state is stated as unknown', () => {
  const conditions = visitConditions({ minimumSpendWon: 0, demo: false, business: { ...business, state: 'UNKNOWN', basis: 'UNKNOWN', acceptingOrders: null } });
  assert.equal(conditions[3]!.text, '가게가 정한 최소 이용 금액은 없어요.');
  assert.match(conditions[4]!.text, /영업 상태 미확인/);
});

test('each condition shows who checks it', () => {
  assert.equal(conditionSourceLabel('SERVER_RULE'), '(앱이 확인)');
  assert.equal(conditionSourceLabel('STORE_SETTING'), '(가게에서 확인)');
});

test('the shown code lifetime is the server default, so the two cannot drift apart', () => {
  const server = readFileSync(new URL('../../../api/src/postgres/claim-slot-service.ts', import.meta.url), 'utf8');
  assert.match(server, new RegExp(`ttlMs: ${claimCodeMinutes} \\* 60 \\* 1000,`));
  const wiring = readFileSync(new URL('../../../api/src/server.ts', import.meta.url), 'utf8');
  const claimWiring = wiring.slice(wiring.indexOf('new PostgresClaimSlotService('), wiring.indexOf('new PostgresClaimSlotService(') + 400);
  assert.doesNotMatch(claimWiring, /ttlMs/, 'server.ts must not override the claim code lifetime');
});

test('the "campaign must be running" rule and the unenforced capacity are both as the server really behaves', () => {
  const server = readFileSync(new URL('../../../api/src/postgres/claim-slot-service.ts', import.meta.url), 'utf8');
  assert.match(server, /findActiveCampaign\(client, slot\.merchant_id, redeemedAt\);\s*if \(!campaign\) \{\s*throw new ClaimSlotError\('CLAIM_CAMPAIGN_UNAVAILABLE'\)/);
  const redeem = server.slice(server.indexOf('async redeem('), server.indexOf('async issueShowcaseTestSlot('));
  assert.ok(redeem.includes('grantReachedGoals('), 'the slice is the real redeem()');
  const rewards = readFileSync(new URL('../../../api/src/postgres/visit-rewards.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(redeem + rewards, /campaign_enrollments|enrollment_capacity|enrolled_count/, 'redeem and grantReachedGoals do not read capacity, so the copy must not claim it');
});

test('no campaign or a campaign that is not running blocks the visit; the server refuses it', () => {
  const ok = { state: 'ACTIVE', enrollment: 'OPEN', rewardAvailability: 'AVAILABLE' } as const;
  assert.deepEqual(coinAvailability(ok), { kind: 'ok' });
  for (const campaign of [null, { ...ok, state: 'PAUSED' }, { ...ok, state: 'ENDED' }, { ...ok, state: 'SCHEDULED' }] as const) {
    const result = coinAvailability(campaign);
    assert.equal(result.kind, 'blocked');
    assert.match((result as { reason: string }).reason, /방문이 기록되지 않아요/);
  }
});

test('display-only oddities are caveats that never claim a rule the server lacks', () => {
  const ok = { state: 'ACTIVE', enrollment: 'OPEN', rewardAvailability: 'AVAILABLE' } as const;
  const reason = (campaign: Parameters<typeof coinAvailability>[0]) => {
    const result = coinAvailability(campaign);
    assert.equal(result.kind, 'caveat');
    return (result as { reason: string }).reason;
  };
  assert.equal(reason({ ...ok, enrollment: 'FULL' }), '참여 인원이 표시상 가득 찼지만, 방문이 확인되면 코인을 받을 수 있어요.');
  assert.match(reason({ ...ok, enrollment: 'CLOSED' }), /표시돼 있어요.*방문 확인 결과로 정해져요/);
  assert.equal(reason({ ...ok, rewardAvailability: 'UNKNOWN' }), '코인 그림이 아직 준비되지 않았어요. 지금 방문하면 보상은 기록되지만, 나중에 그림이 생겨도 이 코인에는 붙지 않아요.');
  assert.match(reason({ ...ok, rewardAvailability: 'EXHAUSTED' }), /소진된 것으로 표시돼 있어요/);
  assert.match(reason({ ...ok, rewardAvailability: 'NOT_RUNNING' }), /운영되지 않는 것으로 표시돼 있어요/);
  for (const campaign of [{ ...ok, enrollment: 'FULL' }, { ...ok, enrollment: 'CLOSED' }, { ...ok, rewardAvailability: 'UNKNOWN' }] as const) {
    assert.doesNotMatch(reason(campaign), /받을 수 없어요|가게에 확인해야/, 'no refusal the server does not make');
  }
});

test('the no-picture caveat never promises a picture later: the server attaches art only when the entitlement is created', () => {
  const unknown = coinAvailability({ state: 'ACTIVE', enrollment: 'OPEN', rewardAvailability: 'UNKNOWN' });
  assert.equal(unknown.kind, 'caveat');
  const text = (unknown as { reason: string }).reason;
  assert.doesNotMatch(text, /준비된 뒤에 보여|나중에 보여|곧 보여|준비되는 대로/);
  assert.match(text, /이 코인에는 붙지 않아요/);
  // The migration that fixes this behaviour says existing entitlements are not back-filled.
  const migrations = new URL('../../../api/migrations/', import.meta.url);
  const trigger = readdirSync(migrations).find((name) => name.startsWith('0034'));
  assert.ok(trigger, '0034 migration exists');
  assert.match(readFileSync(new URL(trigger!, migrations), 'utf8'), /기존 권리에 소급 적용하지 않는다/);
});
