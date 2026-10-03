import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { MerchantDiscoveryError } from './merchant-discovery.js';
import { PostgresCollectiblePreviewService, PostgresMerchantDetailViewService } from './postgres/merchant-discovery.js';
import { runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = testUrl !== undefined && decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');
const skip = safeTestTarget ? false : 'requires a disposable _test PostgreSQL database';

test('공개 수집품 미리보기와 상세 열람은 목록의 공개 조건 및 KST 날짜를 따른다', { skip }, async (t) => {
  const pool = new Pool({ connectionString: testUrl });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE campaign_goals, campaigns, merchants CASCADE');

  for (const [merchantId, status] of [
    ['visible', 'ACTIVE'], ['no-publication', 'ACTIVE'], ['paused', 'PAUSED'], ['bad-goals', 'ACTIVE'],
    ['demo', 'ACTIVE'], ['trial', 'ACTIVE'], ['unmapped', 'ACTIVE'],
  ] as const) {
    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ($1, $1, '', '서울 노원구', 0, $2, $3)`, [merchantId, status, merchantId === 'demo' || merchantId === 'trial']);
    await pool.query(
      `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
       VALUES ($1, $2, '방문 수집품', '2026-09-01', '2026-11-01', 'ACTIVE', true, 10)`,
      [`campaign-${merchantId}`, merchantId]);
    for (const visitCount of merchantId === 'bad-goals' ? [1, 3] : [1, 3, 5]) {
      await pool.query(
        'INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name) VALUES ($1, $2, $3)',
        [`campaign-${merchantId}`, visitCount, `${visitCount}회`]);
    }
  }
  await pool.query(
    `INSERT INTO showcase_guest_trials (account_id, merchant_id, expires_at)
     VALUES ('guest-trial', 'trial', now() + interval '1 day')`);

  const projectId = randomUUID();
  const publicationId = randomUUID();
  await pool.query('INSERT INTO collectible_projects (id, merchant_id, lineage_id) VALUES ($1, $2, $1)', [projectId, 'visible']);
  await pool.query(
    `INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, reward_grades)
     VALUES ($1, $2, 'visible', 'campaign-visible', 1, '{"1":"bronze","3":"silver"}'::jsonb)`,
    [publicationId, projectId]);
  for (const [gradeId, gradeName] of [['bronze', '브론즈'], ['silver', '실버']] as const) {
    await pool.query(
      `INSERT INTO collectible_publication_grades (publication_id, grade_id, summary, detail)
       VALUES ($1, $2, $3::jsonb, '{}'::jsonb)`,
      [publicationId, gradeId, JSON.stringify({
        gradeId, gradeName, shape: 'circle', theme: { name: '가을' }, name: '가게 방문 수집품',
        thumbnailDataUrl: `data:image/png;base64,${gradeId}`,
      })]);
  }
  await pool.query(
    'INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ($1, $2)',
    ['campaign-visible', publicationId]);

  // 같은 점포의 지난 캠페인 발행본이 있어도 현재 공개 캠페인만 선택한다.
  await pool.query(
    `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ('campaign-old', 'visible', '지난 방문 수집품', '2026-08-01', '2026-09-01', 'ENDED', false, 10)`);
  for (const visitCount of [1, 3, 5]) {
    await pool.query('INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name) VALUES ($1, $2, $3)',
      ['campaign-old', visitCount, `${visitCount}회`]);
  }
  const oldProjectId = randomUUID();
  const oldPublicationId = randomUUID();
  await pool.query('INSERT INTO collectible_projects (id, merchant_id, lineage_id) VALUES ($1, $2, $1)', [oldProjectId, 'visible']);
  await pool.query(
    `INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, reward_grades)
     VALUES ($1, $2, 'visible', 'campaign-old', 1, '{"1":"bronze"}'::jsonb)`, [oldPublicationId, oldProjectId]);
  await pool.query(
    `INSERT INTO collectible_publication_grades (publication_id, grade_id, summary, detail)
     VALUES ($1, 'bronze', $2::jsonb, '{}'::jsonb)`,
    [oldPublicationId, JSON.stringify({ name: '지난 발행본', gradeName: '브론즈', shape: 'circle', theme: '여름', thumbnailDataUrl: null })]);
  await pool.query('INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ($1, $2)',
    ['campaign-old', oldPublicationId]);

  const demoProjectId = randomUUID();
  const demoPublicationId = randomUUID();
  await pool.query('INSERT INTO collectible_projects (id, merchant_id, lineage_id) VALUES ($1, $2, $1)', [demoProjectId, 'demo']);
  await pool.query(
    `INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, reward_grades)
     VALUES ($1, $2, 'demo', 'campaign-demo', 1, '{"1":"bronze"}'::jsonb)`, [demoPublicationId, demoProjectId]);
  await pool.query(
    `INSERT INTO collectible_publication_grades (publication_id, grade_id, summary, detail)
     VALUES ($1, 'bronze', $2::jsonb, '{}'::jsonb)`,
    [demoPublicationId, JSON.stringify({ name: '시연 수집품', gradeName: '브론즈', shape: 'circle', theme: { name: '시연' }, thumbnailDataUrl: 'data:image/png;base64,demo' })]);
  await pool.query('INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ($1, $2)',
    ['campaign-demo', demoPublicationId]);

  const unmappedProjectId = randomUUID();
  const unmappedPublicationId = randomUUID();
  await pool.query('INSERT INTO collectible_projects (id, merchant_id, lineage_id) VALUES ($1, $2, $1)', [unmappedProjectId, 'unmapped']);
  await pool.query(
    `INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, reward_grades)
     VALUES ($1, $2, 'unmapped', 'campaign-unmapped', 1, '{}'::jsonb)`, [unmappedPublicationId, unmappedProjectId]);
  await pool.query(
    `INSERT INTO collectible_publication_grades (publication_id, grade_id, summary, detail)
     VALUES ($1, 'bronze', '{"name":"연결 없는 등급의 발행본"}'::jsonb, '{}'::jsonb)`, [unmappedPublicationId]);
  await pool.query('INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ($1, $2)',
    ['campaign-unmapped', unmappedPublicationId]);

  const now = () => new Date('2026-10-03T14:59:59.000Z');
  const preview = new PostgresCollectiblePreviewService(pool, now);
  const views = new PostgresMerchantDetailViewService(pool, now);
  assert.deepEqual(await preview.preview('visible'), {
    merchantId: 'visible', campaignId: 'campaign-visible', name: '가게 방문 수집품',
    goals: [
      { visitCount: 1, gradeId: 'bronze', gradeName: '브론즈', shape: 'circle', theme: '가을', thumbnailDataUrl: 'data:image/png;base64,bronze' },
      { visitCount: 3, gradeId: 'silver', gradeName: '실버', shape: 'circle', theme: '가을', thumbnailDataUrl: 'data:image/png;base64,silver' },
    ],
  });
  assert.equal((await preview.preview('demo')).goals[0]?.theme, '시연');
  assert.deepEqual(await preview.preview('unmapped'), {
    merchantId: 'unmapped', campaignId: 'campaign-unmapped', name: '연결 없는 등급의 발행본', goals: [],
  });
  const assertVisibleMerchantHidden = async () => {
    await assert.rejects(preview.preview('visible'), (error: unknown) =>
      error instanceof MerchantDiscoveryError && error.code === 'COLLECTIBLE_PREVIEW_NOT_FOUND');
    await assert.rejects(views.record('visible', 'list'), (error: unknown) =>
      error instanceof MerchantDiscoveryError && error.code === 'MERCHANT_NOT_FOUND');
  };
  await pool.query("UPDATE merchants SET status = 'PAUSED' WHERE id = 'visible'");
  await assertVisibleMerchantHidden();
  await pool.query("UPDATE merchants SET status = 'ACTIVE' WHERE id = 'visible'");
  await pool.query("UPDATE campaigns SET is_public = false WHERE id = 'campaign-visible'");
  await assertVisibleMerchantHidden();
  await pool.query("UPDATE campaigns SET is_public = true WHERE id = 'campaign-visible'");
  await pool.query("UPDATE campaigns SET starts_at = '2026-10-04' WHERE id = 'campaign-visible'");
  await assertVisibleMerchantHidden();
  await pool.query("UPDATE campaigns SET starts_at = '2026-09-01' WHERE id = 'campaign-visible'");
  await pool.query("UPDATE campaigns SET ends_at = '2026-10-02' WHERE id = 'campaign-visible'");
  await assertVisibleMerchantHidden();
  await pool.query("UPDATE campaigns SET ends_at = '2026-11-01' WHERE id = 'campaign-visible'");
  await pool.query("DELETE FROM campaign_goals WHERE campaign_id = 'campaign-visible' AND target_visit_count = 5");
  await assertVisibleMerchantHidden();
  await pool.query("INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name) VALUES ('campaign-visible', 5, '5회')");
  await pool.query("INSERT INTO showcase_guest_trials (account_id, merchant_id, expires_at) VALUES ('guest-visible', 'visible', now() + interval '1 day')");
  await assertVisibleMerchantHidden();
  await pool.query("DELETE FROM showcase_guest_trials WHERE merchant_id = 'visible'");
  assert.equal((await preview.preview('visible')).campaignId, 'campaign-visible');
  await views.record('demo', 'list');
  await views.record('no-publication', 'list');
  await assert.rejects(preview.preview('no-publication'), (error: unknown) =>
    error instanceof MerchantDiscoveryError && error.code === 'COLLECTIBLE_PREVIEW_NOT_FOUND');
  for (const merchantId of ['paused', 'bad-goals', 'trial', 'unknown']) {
    await assert.rejects(preview.preview(merchantId), (error: unknown) =>
      error instanceof MerchantDiscoveryError && error.code === 'COLLECTIBLE_PREVIEW_NOT_FOUND');
    await assert.rejects(views.record(merchantId, 'list'), (error: unknown) =>
      error instanceof MerchantDiscoveryError && error.code === 'MERCHANT_NOT_FOUND');
  }
  await views.record('visible', 'list');
  await views.record('visible', 'list');
  await views.record('visible', 'map');
  await new PostgresMerchantDetailViewService(pool, () => new Date('2026-10-03T15:00:00.000Z')).record('visible', 'list');
  const counts = await pool.query<{ business_date: string; source: string; views: number }>(
    `SELECT business_date::text, source, views FROM merchant_detail_view_counts
     WHERE merchant_id = 'visible' ORDER BY business_date, source`);
  assert.deepEqual(counts.rows, [
    { business_date: '2026-10-03', source: 'list', views: 2 },
    { business_date: '2026-10-03', source: 'map', views: 1 },
    { business_date: '2026-10-04', source: 'list', views: 1 },
  ]);
  // HTTP 검사를 우회한 쓰기도 허용 경로와 양의 횟수 제약을 통과해야 한다.
  for (const [source, count] of [['invalid', 1], ['other', 0], ['other', -1]] as const) {
    await assert.rejects(pool.query(
      `INSERT INTO merchant_detail_view_counts (merchant_id, business_date, source, views)
       VALUES ('visible', '2026-10-03', $1, $2)`, [source, count]),
    (error: unknown) => error !== null && typeof error === 'object' && Reflect.get(error, 'code') === '23514');
  }

  // 운영자 미디어 제거 후 남은 연결을 읽더라도 사진은 노출하지 않는다.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('masscom.collectible_media_removal', 'on', true)");
    await client.query('UPDATE collectible_publications SET media_removed_at = now() WHERE id = $1', [publicationId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  assert.deepEqual((await preview.preview('visible')).goals.map((goal) => goal.thumbnailDataUrl), [null, null]);
});
