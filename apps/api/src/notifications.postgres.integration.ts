import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Pool } from 'pg';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresNotificationService } from './postgres/notifications.js';
import { runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safe = testUrl && decodeURIComponent(new URL(testUrl).pathname).endsWith('_test');
const skip = safe ? false : 'requires a disposable _test PostgreSQL database';
const now = new Date('2026-10-05T00:00:00.000Z');
const accountLifecycle = new PostgresAccountLifecycle({ hmacSecret: 'notification-test-lifecycle-secret-32-bytes' });
const deviceId = randomUUID();

async function setup(t: TestContext) {
  const pool = new Pool({ connectionString: testUrl });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE notification_items, notification_devices, notification_preferences, account_deletion_requests, auth_sessions, merchants CASCADE');
  const service = new PostgresNotificationService(pool, { accountLifecycle, now: () => now });
  const tokenA = randomBytes(32).toString('base64url');
  const tokenB = randomBytes(32).toString('base64url');
  for (const [account, token] of [['account-a', tokenA], ['account-b', tokenB]] as const) {
    const createdAt = account === 'account-a' ? new Date(now.getTime() - 60_000) : now;
    await pool.query(`INSERT INTO auth_sessions(id, account_id, token_hash, created_at, expires_at, last_authenticated_at)
      VALUES($1,$2,$3,$4,$5,$4)`, [randomUUID(), account, createHash('sha256').update(token).digest(), createdAt, new Date(now.getTime() + 86_400_000)]);
  }
  return { pool, service, tokenA, tokenB };
}

test('inbox dedupes without OS permission; settings are account scoped', { skip }, async t => {
  const { service } = await setup(t);
  const input = { accountId: 'account-a', category: 'REWARD_AVAILABLE' as const, dedupeKey: 'reward:one', title: '보상', body: '받으세요', targetPath: '/collection' };
  assert.equal(await service.enqueue(input), true);
  assert.equal(await service.enqueue(input), false);
  assert.equal((await service.list('account-a')).length, 1);
  assert.deepEqual(await service.list('account-b'), []);
  assert.equal((await service.preferences('account-a')).pushEnabled, false);
  assert.equal((await service.updatePreferences('account-a', { rewardAvailable: false })).rewardAvailable, false);
  assert.equal((await service.preferences('account-b')).rewardAvailable, true);
  const id = (await service.list('account-a'))[0]!.id;
  await service.markRead('account-a', id);
  assert.ok((await service.list('account-a'))[0]!.readAt);
  await assert.rejects(service.markRead('account-b', id));
});

test('device ownership follows the authenticated session and revoked session cannot receive', { skip }, async t => {
  const { pool, service, tokenA, tokenB } = await setup(t);
  await service.updatePreferences('account-a', { pushEnabled: true });
  await service.updatePreferences('account-b', { pushEnabled: true });
  await assert.rejects(service.registerDevice('account-b', deviceId, 'fcm-a', 'android', tokenA));
  await service.registerDevice('account-a', deviceId, 'fcm-a', 'android', tokenA);
  await service.enqueue({ accountId: 'account-a', category: 'REWARD_AVAILABLE', dedupeKey: 'one', title: 'A', body: 'A', targetPath: '/collection' });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM notification_deliveries')).rows[0].n, 1);
  await service.registerDevice('account-b', deviceId, 'fcm-b', 'android', tokenB);
  await service.registerDevice('account-a', deviceId, 'fcm-a', 'android', tokenA); // delayed response from old session must not reclaim this device.
  assert.equal((await pool.query('SELECT account_id FROM notification_devices WHERE device_id=$1', [deviceId])).rows[0].account_id, 'account-b');
  await service.enqueue({ accountId: 'account-a', category: 'REWARD_AVAILABLE', dedupeKey: 'two', title: 'A2', body: 'A2', targetPath: '/collection' });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM notification_deliveries')).rows[0].n, 1);
  await pool.query('UPDATE auth_sessions SET revoked_at=$2 WHERE token_hash=$1', [createHash('sha256').update(tokenB).digest(), now]);
  await service.enqueue({ accountId: 'account-b', category: 'REWARD_AVAILABLE', dedupeKey: 'three', title: 'B', body: 'B', targetPath: '/collection' });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM notification_deliveries')).rows[0].n, 1);
});

test('같은 토큰의 다른 기기 등록에서도 최신 세션과 대기 알림을 보존한다', { skip }, async t => {
  const { pool, service, tokenA, tokenB } = await setup(t);
  const latestDevice = randomUUID();
  const delayedDevice = randomUUID();
  await service.updatePreferences('account-b', { pushEnabled: true });
  await service.registerDevice('account-b', latestDevice, 'shared-token', 'android', tokenB);
  await service.enqueue({ accountId: 'account-b', category: 'REWARD_AVAILABLE', dedupeKey: 'latest', title: 'B', body: 'B', targetPath: '/collection' });
  await service.registerDevice('account-a', delayedDevice, 'shared-token', 'android', tokenA);
  assert.deepEqual((await pool.query('SELECT device_id, account_id, token FROM notification_devices')).rows,
    [{ device_id: latestDevice, account_id: 'account-b', token: 'shared-token' }]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM notification_deliveries')).rows[0].n, 1);

  // 더 최신 세션으로의 정상적인 토큰 이동은 계속 허용한다.
  await service.registerDevice('account-a', delayedDevice, 'rotated-token', 'android', tokenA);
  await service.registerDevice('account-b', latestDevice, 'rotated-token', 'android', tokenB);
  assert.deepEqual((await pool.query('SELECT device_id, account_id, token FROM notification_devices')).rows,
    [{ device_id: latestDevice, account_id: 'account-b', token: 'rotated-token' }]);
});

for (const sameDevice of [false, true]) {
  test(`동률인 다른 세션의 ${sameDevice ? '같은 기기' : '다른 기기'} 등록은 기존 소유권과 대기 delivery를 보존한다`, { skip }, async t => {
    const { pool, service, tokenA, tokenB } = await setup(t);
    await pool.query('UPDATE auth_sessions SET created_at=$1', [now]);
    const ownerDevice = randomUUID();
    await service.updatePreferences('account-b', { pushEnabled: true });
    await service.registerDevice('account-b', ownerDevice, 'shared-token', 'android', tokenB);
    await service.enqueue({ accountId: 'account-b', category: 'REWARD_AVAILABLE', dedupeKey: 'tie', title: 'B', body: 'B', targetPath: '/collection' });
    const devices = (await pool.query('SELECT * FROM notification_devices')).rows;
    const deliveries = (await pool.query('SELECT * FROM notification_deliveries')).rows;
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].status, 'PENDING');

    await service.registerDevice('account-a', sameDevice ? ownerDevice : randomUUID(), sameDevice ? 'different-token' : 'shared-token', 'android', tokenA);
    assert.deepEqual((await pool.query('SELECT * FROM notification_devices')).rows, devices);
    assert.deepEqual((await pool.query('SELECT * FROM notification_deliveries')).rows, deliveries);
  });
}

test('같은 세션은 기기를 재등록하고 토큰을 갱신할 수 있다', { skip }, async t => {
  const { pool, service, tokenA } = await setup(t);
  await service.updatePreferences('account-a', { pushEnabled: true });
  await service.registerDevice('account-a', deviceId, 'original-token', 'android', tokenA);
  await service.enqueue({ accountId: 'account-a', category: 'REWARD_AVAILABLE', dedupeKey: 'reregister', title: 'A', body: 'A', targetPath: '/collection' });
  const device = (await pool.query('SELECT * FROM notification_devices')).rows[0];
  const deliveries = (await pool.query('SELECT * FROM notification_deliveries')).rows;
  assert.equal(deliveries.length, 1);

  await service.registerDevice('account-a', deviceId, 'original-token', 'android', tokenA);
  await service.registerDevice('account-a', deviceId, 'rotated-token', 'android', tokenA);
  assert.deepEqual((await pool.query('SELECT device_id, account_id, session_id, token FROM notification_devices')).rows,
    [{ device_id: deviceId, account_id: 'account-a', session_id: device.session_id, token: 'rotated-token' }]);
  assert.deepEqual((await pool.query('SELECT * FROM notification_deliveries')).rows, deliveries);
});

test('지연된 옛 세션 해제는 같은 계정의 새 세션 바인딩을 보존하고 같은 세션 해제는 삭제한다', { skip }, async t => {
  const { pool, service, tokenA, tokenB } = await setup(t);
  await pool.query('UPDATE auth_sessions SET account_id=$1 WHERE token_hash=$2',
    ['account-a', createHash('sha256').update(tokenB).digest()]);
  await service.registerDevice('account-a', deviceId, 'old-token', 'android', tokenA);

  // 풀 연결을 점유해 옛 DELETE를 대기시킨 뒤 다른 연결로 새 세션을 등록한다.
  const delayedPool = new Pool({ connectionString: testUrl, max: 1 });
  t.after(() => delayedPool.end());
  const delayedService = new PostgresNotificationService(delayedPool, { accountLifecycle, now: () => now });
  const held = await delayedPool.connect();
  const oldDelete = delayedService.unregisterDevice('account-a', deviceId, tokenA);
  try {
    assert.equal(delayedPool.waitingCount, 1);
    await service.registerDevice('account-a', deviceId, 'new-token', 'android', tokenB);
  } finally {
    held.release();
    await oldDelete;
  }
  const newSession = (await pool.query('SELECT id FROM auth_sessions WHERE token_hash=$1',
    [createHash('sha256').update(tokenB).digest()])).rows[0].id;
  assert.deepEqual((await pool.query('SELECT account_id, session_id, token FROM notification_devices WHERE device_id=$1', [deviceId])).rows,
    [{ account_id: 'account-a', session_id: newSession, token: 'new-token' }]);

  await service.unregisterDevice('account-a', deviceId, tokenB);
  assert.equal((await pool.query('SELECT 1 FROM notification_devices WHERE device_id=$1', [deviceId])).rowCount, 0);
});

test('기기 해제는 다른 계정의 바인딩을 삭제하지 않는다', { skip }, async t => {
  const { pool, service, tokenA, tokenB } = await setup(t);
  await service.registerDevice('account-a', deviceId, 'fcm-a', 'android', tokenA);
  const devices = (await pool.query('SELECT * FROM notification_devices')).rows;
  await service.unregisterDevice('account-b', deviceId, tokenB);
  await service.unregisterDevice('account-b', deviceId, tokenA);
  assert.deepEqual((await pool.query('SELECT * FROM notification_devices')).rows, devices);
});

test('계정이 달라도 같은 토큰의 동시 등록은 최신 세션 하나로 수렴한다', { skip }, async t => {
  const { pool, service, tokenA, tokenB } = await setup(t);
  const latestDevice = randomUUID();
  await Promise.all([
    service.registerDevice('account-a', randomUUID(), 'concurrent-token', 'android', tokenA),
    service.registerDevice('account-b', latestDevice, 'concurrent-token', 'android', tokenB),
  ]);
  assert.deepEqual((await pool.query('SELECT device_id, account_id FROM notification_devices')).rows,
    [{ device_id: latestDevice, account_id: 'account-b' }]);
});

test('FCM accepted request marks delivery SENT while receipt is still unproven', { skip }, async t => {
  const { pool, tokenA } = await setup(t);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let sends = 0;
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'mock-access' }), { status: 200 });
    sends++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.message.token, 'fcm-a');
    assert.equal(body.message.android.notification.tag, body.message.data.notificationId);
    assert.equal(body.message.data.targetPath, '/collection');
    return new Response(JSON.stringify({ name: 'projects/test/messages/mock' }), { status: 200 });
  };
  const service = new PostgresNotificationService(pool, { accountLifecycle, now: () => now, fetcher, fcm: { projectId: 'test', clientEmail: 'test@example.com', signingPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() } });
  await service.updatePreferences('account-a', { pushEnabled: true });
  await service.registerDevice('account-a', deviceId, 'fcm-a', 'android', tokenA);
  await service.enqueue({ accountId: 'account-a', category: 'REWARD_AVAILABLE', dedupeKey: 'fcm:test', title: '보상', body: '확인', targetPath: '/collection' });
  assert.deepEqual(await service.deliverDue(), { sent: 1, failed: 0, skipped: 0 });
  assert.equal(sends, 1);
  const row = (await pool.query('SELECT status, provider_message_id FROM notification_deliveries')).rows[0];
  assert.equal(row.status, 'SENT');
  assert.equal(row.provider_message_id, 'projects/test/messages/mock');
});

test('disabled older deliveries do not starve a newer eligible delivery', { skip }, async t => {
  const { pool, tokenA, tokenB } = await setup(t);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sends: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'mock-access' }), { status: 200 });
    sends.push(JSON.parse(String(init?.body)).message.token);
    return new Response(JSON.stringify({ name: 'projects/test/messages/mock' }), { status: 200 });
  };
  const service = new PostgresNotificationService(pool, { accountLifecycle, now: () => now, fetcher, fcm: { projectId: 'test', clientEmail: 'test@example.com', signingPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() } });
  await service.updatePreferences('account-a', { pushEnabled: true });
  await service.registerDevice('account-a', deviceId, 'fcm-a', 'android', tokenA);
  for (let index = 0; index < 51; index++) await service.enqueue({ accountId: 'account-a', category: 'REWARD_AVAILABLE', dedupeKey: `older:${index}`, title: 'old', body: 'old', targetPath: '/collection' });
  await service.updatePreferences('account-a', { pushEnabled: false });
  await service.updatePreferences('account-b', { pushEnabled: true });
  await service.registerDevice('account-b', randomUUID(), 'fcm-b', 'android', tokenB);
  await service.enqueue({ accountId: 'account-b', category: 'REWARD_AVAILABLE', dedupeKey: 'newer', title: 'new', body: 'new', targetPath: '/collection' });
  assert.deepEqual(await service.deliverDue(1), { sent: 1, failed: 0, skipped: 0 });
  assert.deepEqual(sends, ['fcm-b']);
  await service.pruneExpired();
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notification_deliveries WHERE status='PENDING'`)).rows[0].n, 0);
});

test('campaign expiry creates one owner inbox reminder and ignores staff', { skip }, async t => {
  const { pool, service } = await setup(t);
  await pool.query(`INSERT INTO merchants(id,name,story,road_address,minimum_spend_won,status) VALUES('shop','시험점포','','서울',0,'ACTIVE')`);
  await pool.query(`INSERT INTO campaigns(id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES('campaign','shop','가을 행사',$1,$2,'ACTIVE',true,10)`, [new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 48 * 3600_000)]);
  await pool.query(`INSERT INTO merchant_members(merchant_id,account_id,role,status) VALUES('shop','account-a','OWNER','ACTIVE'),('shop','account-b','STAFF','ACTIVE')`);
  assert.equal(await service.enqueueDueReminders(), 1);
  assert.equal(await service.enqueueDueReminders(), 0);
  assert.deepEqual((await service.list('account-a')).map(item => item.category), ['CAMPAIGN_EXPIRING']);
  assert.deepEqual(await service.list('account-b'), []);
});

test('a competing worker cannot claim a slow in-flight delivery before lease expiry', { skip }, async t => {
  const { pool, tokenA } = await setup(t);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const state = { now };
  let releaseSend!: () => void;
  let markEntered!: () => void;
  const entered = new Promise<void>(resolve => { markEntered = resolve; });
  const sending = new Promise<void>(resolve => { releaseSend = resolve; });
  const fetcher: typeof fetch = async input => {
    if (String(input).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'mock-access' }), { status: 200 });
    markEntered(); await sending;
    return new Response(JSON.stringify({ name: 'projects/test/messages/once' }), { status: 200 });
  };
  const options = { accountLifecycle, now: () => state.now, fetcher, fcm: { projectId: 'test', clientEmail: 'test@example.com', signingPem: privateKey.export({ type: 'pkcs8' as const, format: 'pem' as const }).toString() } };
  const first = new PostgresNotificationService(pool, options);
  const second = new PostgresNotificationService(pool, options);
  await first.updatePreferences('account-a', { pushEnabled: true });
  await first.registerDevice('account-a', deviceId, 'fcm-a', 'android', tokenA);
  await first.enqueue({ accountId: 'account-a', category: 'REWARD_AVAILABLE', dedupeKey: 'slow', title: 'A', body: 'A', targetPath: '/collection' });
  const running = first.deliverDue(1);
  await entered;
  state.now = new Date(now.getTime() + 60_000);
  assert.deepEqual(await second.deliverDue(1), { sent: 0, failed: 0, skipped: 0 });
  releaseSend();
  assert.deepEqual(await running, { sent: 1, failed: 0, skipped: 0 });
});

test('repeated FCM authorization failures reach a terminal delivery state', { skip }, async t => {
  const { pool, tokenA } = await setup(t);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const state = { now };
  const fetcher: typeof fetch = async () => new Response('{}', { status: 401 });
  const service = new PostgresNotificationService(pool, { accountLifecycle, now: () => state.now, fetcher,
    fcm: { projectId: 'test', clientEmail: 'test@example.com', signingPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() } });
  await service.updatePreferences('account-a', { pushEnabled: true });
  await service.registerDevice('account-a', deviceId, 'fcm-a', 'android', tokenA);
  await service.enqueue({ accountId: 'account-a', category: 'REWARD_AVAILABLE', dedupeKey: 'auth-failure', title: 'A', body: 'A', targetPath: '/collection' });
  for (let attempt = 0; attempt < 5; attempt++) {
    await service.deliverDue();
    state.now = new Date(state.now.getTime() + 5 * 60_000);
  }
  const row = (await pool.query('SELECT status, attempts, last_error FROM notification_deliveries')).rows[0];
  assert.deepEqual(row, { status: 'FAILED', attempts: 5, last_error: 'FCM_AUTH' });
});

test('reward and coupon reminders link to the owning account exact item', { skip }, async t => {
  const { pool, service } = await setup(t);
  const offerId = randomUUID(); const couponId = randomUUID();
  const slotId = randomUUID(); const visitId = randomUUID(); const rewardId = randomUUID();
  await pool.query(`INSERT INTO merchants(id,name,story,road_address,minimum_spend_won,status) VALUES('shop','시험점포','','서울',0,'ACTIVE')`);
  await pool.query(`INSERT INTO merchant_members(merchant_id,account_id,role,status) VALUES('shop','staff','STAFF','ACTIVE')`);
  await pool.query(`INSERT INTO campaigns(id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES('campaign','shop','방문 행사',$1,$2,'ACTIVE',true,10)`, [new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 30 * 86_400_000)]);
  await pool.query(`INSERT INTO campaign_goals(campaign_id,target_visit_count,display_name) VALUES('campaign',1,'한 번 방문')`);
  await pool.query(`INSERT INTO claim_slots(id,merchant_id,customer_account_id,merchant_reference_hash,created_by_account_id,token_hash,status,expires_at,claimed_at,created_at)
    VALUES($1,'shop','account-a',$2,'staff',$3,'CLAIMED',$4,$5,$6)`, [slotId, randomBytes(32), randomBytes(32), new Date(now.getTime() + 15 * 60_000), now, new Date(now.getTime() - 5 * 60_000)]);
  await pool.query(`INSERT INTO visit_events(id,claim_slot_id,merchant_id,campaign_id,customer_account_id,occurred_at,business_date,verification_level,status,progress_counted)
    VALUES($1,$2,'shop','campaign','account-a',$3,'2026-10-05','MERCHANT_CONFIRMED','VALID',true)`, [visitId, slotId, now]);
  await pool.query(`INSERT INTO reward_entitlements(id,customer_account_id,campaign_id,target_visit_count,source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
    VALUES($1,'account-a','campaign',1,$2,'GRANTED','v1',$3,$4)`, [rewardId, visitId, now, new Date(now.getTime() + 7 * 86_400_000)]);
  await pool.query(`INSERT INTO badge_reward_offers(id,milestone,merchant_id,title,detail,valid_days,issuance_cap,status,consent_note)
    VALUES($1,1,'shop','시험 쿠폰','상세',7,100,'ACTIVE','점주 동의')`, [offerId]);
  await pool.query(`INSERT INTO badge_coupons(id,customer_account_id,milestone,offer_id,merchant_id,title,detail,status,issued_at,expires_at)
    VALUES($1,'account-a',1,$2,'shop','시험 쿠폰','상세','ISSUED',$3,$4)`, [couponId, offerId, now, new Date(now.getTime() + 12 * 3600_000)]);
  assert.equal(await service.enqueueDueReminders(), 2);
  const items = await service.list('account-a');
  assert.deepEqual(new Set(items.map(item => item.targetPath)), new Set([
    `/collection?focus=collectible&entitlement=${rewardId}`,
    `/collection?focus=rewards&coupon=${couponId}`,
  ]));
  assert.deepEqual(await service.list('account-b'), []);
});

test('FCM typed UNREGISTERED removes stale token; generic 404 keeps it for retry', { skip }, async t => {
  const { pool, tokenA } = await setup(t);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let typed = false;
  const fetcher: typeof fetch = async input => {
    if (String(input).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'mock-access' }), { status: 200 });
    return new Response(JSON.stringify(typed
      ? { error: { code: 404, status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } }
      : { error: { code: 404, status: 'NOT_FOUND', message: 'project missing' } }), { status: 404 });
  };
  const service = new PostgresNotificationService(pool, { accountLifecycle, now: () => now, fetcher,
    fcm: { projectId: 'test', clientEmail: 'test@example.com', signingPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() } });
  await service.updatePreferences('account-a', { pushEnabled: true });
  await service.registerDevice('account-a', deviceId, 'fcm-a', 'android', tokenA);
  await service.enqueue({ accountId: 'account-a', category: 'REWARD_AVAILABLE', dedupeKey: 'generic-404', title: 'A', body: 'A', targetPath: '/collection' });
  assert.equal((await service.deliverDue()).failed, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM notification_devices')).rows[0].n, 1);
  assert.equal((await pool.query('SELECT status FROM notification_deliveries')).rows[0].status, 'PENDING');
  typed = true;
  await service.enqueue({ accountId: 'account-a', category: 'REWARD_AVAILABLE', dedupeKey: 'stale-token', title: 'B', body: 'B', targetPath: '/collection' });
  assert.equal((await service.deliverDue()).failed, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM notification_devices')).rows[0].n, 0);
});

async function seedReminderSources(pool: Pool) {
  const offerId = randomUUID(); const couponId = randomUUID();
  const slotId = randomUUID(); const visitId = randomUUID(); const rewardId = randomUUID();
  await pool.query(`INSERT INTO merchants(id,name,story,road_address,minimum_spend_won,status) VALUES('shop','시험점포','','서울',0,'ACTIVE')`);
  await pool.query(`INSERT INTO merchant_members(merchant_id,account_id,role,status) VALUES('shop','staff','STAFF','ACTIVE'),('shop','account-a','OWNER','ACTIVE')`);
  await pool.query(`INSERT INTO campaigns(id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES('campaign','shop','방문 행사',$1,$2,'ACTIVE',true,10)`, [new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 48 * 3600_000)]);
  await pool.query(`INSERT INTO campaign_goals(campaign_id,target_visit_count,display_name) VALUES('campaign',1,'한 번 방문')`);
  await pool.query(`INSERT INTO claim_slots(id,merchant_id,customer_account_id,merchant_reference_hash,created_by_account_id,token_hash,status,expires_at,claimed_at,created_at)
    VALUES($1,'shop','account-a',$2,'staff',$3,'CLAIMED',$4,$5,$6)`, [slotId, randomBytes(32), randomBytes(32), new Date(now.getTime() + 15 * 60_000), now, new Date(now.getTime() - 5 * 60_000)]);
  await pool.query(`INSERT INTO visit_events(id,claim_slot_id,merchant_id,campaign_id,customer_account_id,occurred_at,business_date,verification_level,status,progress_counted)
    VALUES($1,$2,'shop','campaign','account-a',$3,'2026-10-05','MERCHANT_CONFIRMED','VALID',true)`, [visitId, slotId, now]);
  await pool.query(`INSERT INTO reward_entitlements(id,customer_account_id,campaign_id,target_visit_count,source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
    VALUES($1,'account-a','campaign',1,$2,'GRANTED','v1',$3,$4)`, [rewardId, visitId, now, new Date(now.getTime() + 7 * 86_400_000)]);
  await pool.query(`INSERT INTO badge_reward_offers(id,milestone,merchant_id,title,detail,valid_days,issuance_cap,status,consent_note)
    VALUES($1,1,'shop','시험 쿠폰','상세',7,100,'ACTIVE','점주 동의')`, [offerId]);
  await pool.query(`INSERT INTO badge_coupons(id,customer_account_id,milestone,offer_id,merchant_id,title,detail,status,issued_at,expires_at)
    VALUES($1,'account-a',1,$2,'shop','시험 쿠폰','상세','ISSUED',$3,$4)`, [couponId, offerId, now, new Date(now.getTime() + 12 * 3600_000)]);
  return { rewardId, couponId };
}

for (const phase of ['before-claim', 'after-claim'] as const) {
  for (const change of ['reward-canceled', 'coupon-redeemed', 'coupon-extended', 'campaign-extended', 'campaign-paused', 'owner-revoked'] as const) {
    test(`live reminder source ${change} invalidates inbox and push ${phase}`, { skip }, async t => {
      const { pool, tokenA } = await setup(t);
      const { rewardId, couponId } = await seedReminderSources(pool);
      const category = change.startsWith('reward') ? 'REWARD_AVAILABLE' : change.startsWith('coupon') ? 'COUPON_EXPIRING' : 'CAMPAIGN_EXPIRING';
      const mutate = async () => {
        if (change === 'reward-canceled') await pool.query("UPDATE reward_entitlements SET status='CANCELED' WHERE id=$1", [rewardId]);
        if (change === 'coupon-redeemed') await pool.query("UPDATE badge_coupons SET status='REDEEMED', redeemed_at=$2, redeemed_by_account_id='staff' WHERE id=$1", [couponId, now]);
        if (change === 'coupon-extended') await pool.query("UPDATE badge_coupons SET expires_at=expires_at+interval '7 days' WHERE id=$1", [couponId]);
        if (change === 'campaign-extended') await pool.query("UPDATE campaigns SET ends_at=ends_at+interval '7 days' WHERE id='campaign'");
        if (change === 'campaign-paused') await pool.query("UPDATE campaigns SET status='PAUSED' WHERE id='campaign'");
        if (change === 'owner-revoked') await pool.query("UPDATE merchant_members SET status='REVOKED', revoked_at=$1 WHERE merchant_id='shop' AND account_id='account-a'", [now]);
      };
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const sentCategories: string[] = [];
      const fetcher: typeof fetch = async (input, init) => {
        if (String(input).includes('oauth2.googleapis.com')) {
          if (phase === 'after-claim') await mutate();
          return new Response(JSON.stringify({ access_token: 'mock-access' }), { status: 200 });
        }
        const noticeId = JSON.parse(String(init?.body)).message.data.notificationId;
        sentCategories.push((await pool.query('SELECT category FROM notification_items WHERE id=$1', [noticeId])).rows[0].category);
        return new Response(JSON.stringify({ name: 'projects/test/messages/mock' }), { status: 200 });
      };
      const service = new PostgresNotificationService(pool, { accountLifecycle, now: () => now, fetcher,
        fcm: { projectId: 'test', clientEmail: 'test@example.com', signingPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() } });
      await service.updatePreferences('account-a', { pushEnabled: true });
      await service.registerDevice('account-a', deviceId, 'fcm-a', 'android', tokenA);
      assert.equal(await service.enqueueDueReminders(), 3);
      if (phase === 'before-claim') await mutate();
      const result = await service.deliverDue();
      assert.equal(result.sent, 2);
      assert.equal(result.skipped, phase === 'after-claim' ? 1 : 0);
      assert.equal(sentCategories.includes(category), false);
      assert.equal((await service.list('account-a')).some(item => item.category === category), false);
      await service.pruneExpired();
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM notification_deliveries WHERE status IN ('PENDING','LEASED')")).rows[0].n, 0);
      if (change === 'campaign-extended') {
        await pool.query("UPDATE campaigns SET ends_at=$1 WHERE id='campaign'", [new Date(now.getTime() + 60 * 3600_000)]);
        assert.equal(await service.enqueueDueReminders(), 1);
        assert.equal((await service.list('account-a')).filter(item => item.category === category).length, 1);
      }
    });
  }
}
