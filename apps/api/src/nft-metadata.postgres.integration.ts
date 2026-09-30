// Issue #254: 점포 동네·업종 관리와 공개 NFT 메타데이터 경로를 실제 PostgreSQL에서 확인한다.
// 스냅샷을 만드는 쪽(Worker finalize)은 apps/worker의 PostgreSQL 통합 시험이 확인하고, 여기서는 같은 표를 읽는 API를 본다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { PostgresAdminService } from './postgres/admin.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresNftMetadataReader } from './postgres/nft-metadata.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = testUrl && decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');
const skip = safeTestTarget ? false : 'requires a disposable _test PostgreSQL database';
const hmacSecret = 'nft-metadata-test-account-deletion-hmac-secret';

async function makeAdmin(pool: Pool, service: PostgresAdminService): Promise<string> {
  const subject = `admin-${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
    VALUES ('google', $1, $2, now())`, [subject, accountId]);
  await service.grant(subject);
  return accountId;
}

const base = { story: '실제 점포', roadAddress: '서울 노원구 월계로 1', minimumSpendWon: 5000,
  menuItems: [{ name: '김밥', priceWon: 4500 }], businessHours: '월–금 10:00–20:00' };

test('관리자는 동네·업종을 넣고 비우며, 키가 없으면 그대로 두고 규칙에 어긋나면 거절한다(공개 조건은 그대로)', { skip }, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const service = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    const admin = await makeAdmin(pool, service);
    const created = await service.createMerchant(admin, {
      ...base, name: `동네 점포 ${randomUUID()}`, neighborhood: ' 월계1동 ', category: '분식',
    });
    assert.equal(created.neighborhood, '월계1동');
    assert.equal(created.category, '분식');

    // 옛 관리자 웹처럼 키를 보내지 않으면 그대로 둔다.
    const kept = await service.updateMerchant(admin, created.id, created.version, { ...base, name: created.name });
    assert.equal(kept.neighborhood, '월계1동');
    assert.equal(kept.category, '분식');

    for (const bad of [{ neighborhood: '서울 노원구 월계로 1' }, { neighborhood: 'Wolgye' }, { category: '편의점' },
      { neighborhood: 12 as unknown as string }]) {
      await assert.rejects(service.updateMerchant(admin, created.id, kept.version, { ...base, name: created.name, ...bad }),
        { code: 'ADMIN_INVALID_INPUT' }, JSON.stringify(bad));
    }
    await assert.rejects(service.createMerchant(admin, { ...base, name: 'x', neighborhood: '월계로' }),
      { code: 'ADMIN_INVALID_INPUT' });

    // 동네·업종이 없어도 공개할 수 있다(#246 공개 조건 불변).
    const cleared = await service.updateMerchant(admin, created.id, kept.version,
      { ...base, name: created.name, neighborhood: null, category: '' });
    assert.equal(cleared.neighborhood, null);
    assert.equal(cleared.category, null);
    const published = await service.publishMerchant(admin, created.id, cleared.version, 'CS-2609-01');
    assert.equal(published.status, 'ACTIVE');
    const reset = await service.updateMerchant(admin, created.id, published.version,
      { ...base, name: created.name, neighborhood: '상계3·4동', category: '카페' });
    assert.deepEqual([reset.neighborhood, reset.category], ['상계3·4동', '카페']);
    const listed = (await service.listMerchants(admin)).find(item => item.id === created.id);
    assert.deepEqual([listed?.neighborhood, listed?.category], ['상계3·4동', '카페']);

    // DB CHECK는 앱 검사를 거치지 않은 값도 막는다.
    await assert.rejects(pool.query(`UPDATE merchants SET neighborhood = '월계로 12' WHERE id = $1`, [created.id]),
      /merchants_neighborhood_check/);
    await assert.rejects(pool.query(`UPDATE merchants SET category = '편의점' WHERE id = $1`, [created.id]),
      /merchants_category_check/);
  } finally {
    await pool.end();
  }
});

async function startServer(t: TestContext, pool: Pool): Promise<string> {
  const service = new WalletChallengeService({
    store: new InMemoryChallengeStore(), domain: 'api.masscom.local', uri: 'https://api.masscom.local/wallet/verify',
    chainId: 84532, ttlMs: 60_000, nonce: () => 'abc12345def67890', challengeId: () => 'challenge-1',
  });
  const server = createApiServer(service, developmentHeaderAccountResolver,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, false, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, new PostgresNftMetadataReader(pool));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

// 발행 확정된 토큰 하나(시리즈 series-meta-3, 토큰 9)까지의 최소 행.
async function seedFinalizedToken(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE nft_metadata_images, nft_assets, chain_events, mint_tx_attempts, outbox_events, mint_jobs, nft_series, wallet_bindings, reward_entitlements, visit_events, claim_slots, campaign_goals, campaigns, merchants CASCADE');
  await pool.query(`INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
    VALUES ('merchant-meta', '월계 김밥', '시험 점포', '서울 노원구 데모로 1', 0, 'ACTIVE', true)`);
  await pool.query(`INSERT INTO merchant_members (merchant_id, account_id, role, status)
    VALUES ('merchant-meta', 'staff-meta', 'STAFF', 'ACTIVE')`);
  await pool.query(`INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
    VALUES ('campaign-meta', 'merchant-meta', '가을 방문 도감', '2026-09-01T00:00:00Z', '2026-10-31T00:00:00Z', 'ACTIVE', true, 10)`);
  await pool.query(`INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name) VALUES ('campaign-meta', 3, '세 번째')`);
  await pool.query(`INSERT INTO claim_slots (id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
      token_hash, status, expires_at, claimed_at, created_at, updated_at)
    VALUES ('00000000-0000-4000-8000-000000000254', 'merchant-meta', 'customer-meta', decode(repeat('11', 32), 'hex'),
      'staff-meta', decode(repeat('22', 32), 'hex'), 'CLAIMED', '2026-09-19T03:15:00Z', '2026-09-19T03:00:00Z',
      '2026-09-19T02:55:00Z', '2026-09-19T03:00:00Z')`);
  await pool.query(`INSERT INTO visit_events (id, claim_slot_id, merchant_id, campaign_id, customer_account_id, occurred_at,
      business_date, verification_level, status, progress_counted)
    VALUES ('10000000-0000-4000-8000-000000000254', '00000000-0000-4000-8000-000000000254', 'merchant-meta', 'campaign-meta',
      'customer-meta', '2026-09-19T03:00:00Z', '2026-09-19', 'MERCHANT_CONFIRMED', 'VALID', true)`);
  await pool.query(`INSERT INTO reward_entitlements (id, customer_account_id, campaign_id, target_visit_count,
      source_visit_event_id, status, policy_version, earned_at, claim_expires_at)
    VALUES ('20000000-0000-4000-8000-000000000254', 'customer-meta', 'campaign-meta', 3,
      '10000000-0000-4000-8000-000000000254', 'FULFILLED', 'fixed-1', '2026-09-19T03:00:00Z', '2026-12-18T03:00:00Z')`);
  await pool.query(`INSERT INTO wallet_bindings (id, account_id, address_checksum, address_normalized, chain_id,
      binding_version, status, verified_at, created_at, updated_at)
    VALUES ('30000000-0000-4000-8000-000000000254', 'customer-meta', '0x4000000000000000000000000000000000000004',
      '0x4000000000000000000000000000000000000004', 84532, 1, 'VERIFIED', now(), now(), now())`);
  await pool.query(`INSERT INTO nft_series (id, campaign_id, target_visit_count, chain_id, contract_address,
      contract_address_normalized, series_key, max_ever_minted, status)
    VALUES ('series-meta-3', 'campaign-meta', 3, 84532, '0x7000000000000000000000000000000000000007',
      '0x7000000000000000000000000000000000000007', decode(repeat('33', 32), 'hex'), 10, 'ACTIVE')`);
  await pool.query(`INSERT INTO mint_jobs (id, entitlement_id, account_id, nft_series_id, reward_key, wallet_binding_id,
      binding_version, recipient_address, recipient_address_normalized, chain_id, contract_address,
      contract_address_normalized, series_key, consent_version, idempotency_key, request_fingerprint, status,
      transaction_hash, token_id, finalized_at, created_at, updated_at)
    VALUES ('40000000-0000-4000-8000-000000000254', '20000000-0000-4000-8000-000000000254', 'customer-meta',
      'series-meta-3', decode(repeat('44', 32), 'hex'), '30000000-0000-4000-8000-000000000254', 1,
      '0x4000000000000000000000000000000000000004', '0x4000000000000000000000000000000000000004', 84532,
      '0x7000000000000000000000000000000000000007', '0x7000000000000000000000000000000000000007',
      decode(repeat('33', 32), 'hex'), 'nft-mint-v1', 'metadata-job-254', decode(repeat('66', 32), 'hex'), 'FINALIZED',
      '0x${'77'.repeat(32)}', 9, now(), now(), now())`);
  await pool.query(`INSERT INTO chain_events (id, chain_id, contract_address_normalized, transaction_hash, log_index,
      block_number, block_hash, reward_key, series_key, recipient_address_normalized, token_id, status, observed_at, finalized_at)
    VALUES ('70000000-0000-4000-8000-000000000254', 84532, '0x7000000000000000000000000000000000000007',
      '0x${'77'.repeat(32)}', 0, 100, '0x${'88'.repeat(32)}', decode(repeat('44', 32), 'hex'),
      decode(repeat('33', 32), 'hex'), '0x4000000000000000000000000000000000000004', 9, 'FINALIZED', now(), now())`);
  await pool.query(`INSERT INTO nft_assets (id, mint_job_id, chain_event_id, chain_id, contract_address,
      contract_address_normalized, token_id, reward_key, recipient_address, recipient_address_normalized, finalized_at)
    VALUES ('80000000-0000-4000-8000-000000000254', '40000000-0000-4000-8000-000000000254',
      '70000000-0000-4000-8000-000000000254', 84532, '0x7000000000000000000000000000000000000007',
      '0x7000000000000000000000000000000000000007', 9, decode(repeat('44', 32), 'hex'),
      '0x4000000000000000000000000000000000000004', '0x4000000000000000000000000000000000000004', now())`);
}

test('공개 경로는 확정 뒤 고정된 메타데이터·그림만 주고 확정 전·다른 시리즈·없는 토큰은 404다', { skip }, async (t) => {
  const pool = new Pool({ connectionString: testUrl });
  t.after(() => pool.end());
  await runMigrations(pool);
  await seedFinalizedToken(pool);
  const url = await startServer(t, pool);

  // 체인 확정 전(스냅샷 없음)에는 토큰이 있어도 404다.
  assert.equal((await fetch(`${url}/nft-metadata/series-meta-3/9.json`)).status, 404);

  const image = Buffer.from('preserved-webp');
  const sha = 'c'.repeat(64);
  const json = `{"name":"월계 김밥 방문 도장","description":"월계 김밥 3번째 방문 도장입니다.","image":"https://masscom.kr/nft-metadata/images/${sha}.webp","attributes":[]}`;
  await pool.query('INSERT INTO nft_metadata_images (sha256, image) VALUES ($1, $2)', [sha, image]);
  await pool.query(`INSERT INTO nft_token_metadata (nft_asset_id, nft_series_id, token_id, metadata_json, image_sha256)
    VALUES ('80000000-0000-4000-8000-000000000254', 'series-meta-3', 9, $1, $2)`, [json, sha]);

  const found = await fetch(`${url}/nft-metadata/series-meta-3/9.json`);
  assert.equal(found.status, 200);
  assert.equal(found.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(found.headers.get('access-control-allow-origin'), '*');
  assert.equal(found.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await found.text(), json, 'stored bytes are served unchanged');

  const served = await fetch(`${url}/nft-metadata/images/${sha}.webp`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), image);

  // 가게가 정보를 바꿔도 응답은 그대로다.
  await pool.query(`UPDATE merchants SET name = '바뀐 이름', neighborhood = '중계동' WHERE id = 'merchant-meta'`);
  assert.equal(await (await fetch(`${url}/nft-metadata/series-meta-3/9.json`)).text(), json);

  for (const path of ['/nft-metadata/series-meta-3/10.json', '/nft-metadata/series-other/9.json',
    `/nft-metadata/images/${'d'.repeat(64)}.webp`]) {
    const missing = await fetch(`${url}${path}`);
    assert.equal(missing.status, 404, path);
    assert.equal(missing.headers.get('cache-control'), 'no-store', path);
  }
  // 신고된 그림은 운영자가 그림 행만 내린다: 그림 주소는 404, 메타데이터는 그대로. 메타데이터 행은 지울 수 없다.
  await pool.query('DELETE FROM nft_metadata_images WHERE sha256 = $1', [sha]);
  assert.equal((await fetch(`${url}/nft-metadata/images/${sha}.webp`)).status, 404);
  assert.equal(await (await fetch(`${url}/nft-metadata/series-meta-3/9.json`)).text(), json);
  await assert.rejects(pool.query('DELETE FROM nft_token_metadata'), /immutable/);
  // 같은 시리즈·토큰의 두 번째 스냅샷은 DB가 막는다.
  await assert.rejects(pool.query(`INSERT INTO nft_token_metadata (nft_asset_id, nft_series_id, token_id, metadata_json)
    VALUES ('80000000-0000-4000-8000-000000000254', 'series-meta-3', 9, '{}')`), /duplicate key/);
});
