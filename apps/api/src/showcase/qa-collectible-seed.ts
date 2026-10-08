// #295 scripts/qa-local.sh 전용: 로컬 QA DB에 사진 수집품 하나를 만들고 바로 게시해, 방문·보상 흐름을 실제 수집품으로
// 확인할 수 있게 한다. collectible-project-test-support.ts의 photoProject()를 그대로 쓴다(목표 1·3·5회에 연결된
// 등급 표 rewardGrades는 게시 시 표준 방문보상 {1: 'bronze', 3: 'silver', 5: 'gold'}로 고정된다). 운영·hosted DB에는 절대 연결하지 않는다.
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { photoProject } from '../collectible-project-test-support.js';
import { PostgresCollectibleProjectService } from '../postgres/collectible-project.js';
import { assertLocalShowcaseDatabaseUrl, assertShowcaseDatabaseTarget, SHOWCASE_CAMPAIGN_ID, SHOWCASE_MERCHANT_ID, SHOWCASE_STAFF_ACCOUNT_ID } from './local-seed.js';

export async function seedQaCollectible(
  databaseUrl: string | undefined,
  openPool: (url: string) => Pool = (url) => new Pool({ connectionString: url }),
): Promise<{ projectId: string; publicationId: string }> {
  const checkedUrl = assertLocalShowcaseDatabaseUrl(databaseUrl ?? '');
  const pool = openPool(checkedUrl);
  try {
    await assertShowcaseDatabaseTarget(pool, 'masscom_showcase_test');
    const service = new PostgresCollectibleProjectService(pool, { staffMayManageArt: true });
    const input = { merchantId: SHOWCASE_MERCHANT_ID, accountId: SHOWCASE_STAFF_ACCOUNT_ID };
    const created = await service.create({ ...input, project: photoProject('QA 도장') });
    const published = await service.publish({
      ...input, projectId: created.id, expectedVersion: created.version, campaignId: SHOWCASE_CAMPAIGN_ID,
    });
    return { projectId: published.project.id, publicationId: published.publicationId };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await seedQaCollectible(process.env.SHOWCASE_TEST_DATABASE_URL);
    console.log('QA_COLLECTIBLE_SEEDED', result.projectId, result.publicationId);
  } catch {
    console.error('QA_COLLECTIBLE_SEED_FAILED');
    process.exitCode = 1;
  }
}
