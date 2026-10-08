// #322: 호스트 시연 시드가 월계 공공데이터 점포 캠페인마다 수집품 게시물을 정확히 하나씩 붙이고, 시드 뒤 첫 방문 보상이
// /collection 읽기에서 artwork를 갖는지 확인한다. tests/ops/run_showcase_host_postgres.sh가 새 일회용 컨테이너로 돌린다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresClaimSlotService } from '../postgres/claim-slot-service.js';
import { PostgresCollectionReader } from '../postgres/collection.js';
import { PostgresCourseService } from '../postgres/courses.js';
import { runMigrations } from '../postgres/migrate.js';
import { seedHostedShowcase } from './host-seed.js';
import { SHOWCASE_COURSE_ID } from './local-seed.js';
import { storeCollectibleArt } from './store-collectible-art.js';
import { WOLGYE_PRISM_STORE, WOLGYE_STORES } from './wolgye-seed.js';

const testUrl = process.env.TEST_SHOWCASE_HOST_DATABASE_URL;
const safeTestTarget = (() => {
  if (!testUrl) return false;
  try {
    const url = new URL(testUrl);
    return url.hostname === '127.0.0.1' && url.port === '55435' &&
      url.pathname === '/masscom_showcase' && url.username === 'masscom_showcase';
  } catch { return false; }
})();

const storeCampaigns = WOLGYE_STORES.map((store) => `${store.id}-campaign`);

async function publicationCounts(pool: Pool): Promise<number[]> {
  const tables = ['collectible_projects', 'collectible_publications', 'collectible_publication_grades', 'campaign_collectible_publications'];
  const results = await Promise.all(tables.map((table) => pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM ${table}`)));
  return results.map(({ rows }) => rows[0]?.total ?? -1);
}

test('hosted seed publishes one collectible per Wolgye store, idempotently, and a first visit reward carries artwork', {
  skip: safeTestTarget ? false : 'requires a newly created disposable PostgreSQL container on 127.0.0.1:55435',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  try {
    await runMigrations(pool);
    await seedHostedShowcase(pool);
    await Promise.all(Array.from({ length: 4 }, () => seedHostedShowcase(pool)));
    await seedHostedShowcase(pool);
    // Each public-data campaign has one publication and three grade snapshots.
    assert.deepEqual(await publicationCounts(pool), [WOLGYE_STORES.length, WOLGYE_STORES.length, 3 * WOLGYE_STORES.length, WOLGYE_STORES.length]);
    const gradeRows = await pool.query<{ campaign_id: string; grades: string[] }>(
      `SELECT link.campaign_id, array_agg(grade.grade_id ORDER BY grade.grade_id) AS grades
       FROM campaign_collectible_publications link
       JOIN collectible_publication_grades grade ON grade.publication_id = link.publication_id
       WHERE link.campaign_id = ANY($1::text[])
       GROUP BY link.campaign_id ORDER BY link.campaign_id`, [storeCampaigns]);
    assert.deepEqual(gradeRows.rows.map((row) => [row.campaign_id, row.grades]),
      WOLGYE_STORES.map((store) => [storeCampaigns[WOLGYE_STORES.indexOf(store)],
        store.id === WOLGYE_PRISM_STORE.id ? ['bronze', 'prism', 'silver'] : ['bronze', 'gold', 'silver']])
        .sort(([left], [right]) => String(left).localeCompare(String(right))));
    const linked = await pool.query<{ campaign_id: string }>(
      'SELECT campaign_id FROM campaign_collectible_publications WHERE campaign_id = ANY($1::text[]) ORDER BY campaign_id',
      [storeCampaigns]);
    assert.deepEqual(linked.rows.map((row) => row.campaign_id), [...storeCampaigns].sort());
    // 호스트 시드는 계정·점주 멤버 행을 만들지 않는다(#322도 마찬가지).
    const members = await pool.query('SELECT 1 FROM merchant_members');
    assert.equal(members.rowCount, 0);

    const now = new Date();
    for (const [index, store] of WOLGYE_STORES.slice(0, 3).entries()) {
      const merchantId = store.id;
      const accountId = `artwork-customer-${index}`;
      const claims = new PostgresClaimSlotService(pool, {
        referenceHmacSecret: 'test-only-artwork-reference-secret-32-bytes', now: () => now,
      });
      const issued = await claims.issueShowcaseTestSlot({ merchantId, accountId });
      const redeemed = await claims.redeem({ accountId, token: issued.token });
      assert.equal(redeemed.grantedRewards.length, 1);
      const snapshot = await new PostgresCollectionReader(pool).getCollection(accountId);
      const item = snapshot.collectibles.find((entry) => entry.campaignId === storeCampaigns[index]);
      assert.ok(item?.artwork, `store ${index} first visit reward has artwork`);
      assert.equal(item.artwork.gradeId, 'bronze');
      assert.ok(item.artwork.name);
      assert.ok(item.artwork.shape);
      const art = index === 0 ? 'b' : index === 1 ? 'b' : 'c';
      assert.equal(item.artwork.thumbnailDataUrl, storeCollectibleArt[art].thumbnail);
      if (index === 0) {
        const afterCampaign = new Date(now.getTime() + 31 * 86400000);
        const course = await new PostgresCourseService(pool, { includeDemo: true, now: () => afterCampaign })
          .get(accountId, SHOWCASE_COURSE_ID);
        assert.equal(course.steps[0]?.artwork?.thumbnailDataUrl, item.artwork.thumbnailDataUrl);
      }
    }
    assert.deepEqual(await publicationCounts(pool), [WOLGYE_STORES.length, WOLGYE_STORES.length, 3 * WOLGYE_STORES.length, WOLGYE_STORES.length]);
  } finally {
    await pool.end();
  }
});
