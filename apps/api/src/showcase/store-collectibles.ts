// #322 시연 호스트 시드 전용: 가상 점포 A·B·C 캠페인마다 수집품 게시물 하나를 붙인다. 붙이지 않으면 보상권에 서버 그림
// (collection의 artwork)이 없어 앱이 "받은 수집품 보기"를 숨기고 봉투 연출에 들어갈 수 없다.
// 점주 편집기 경로(PostgresCollectibleProjectService.publish)는 ACTIVE 점주 계정 행을 요구하지만 호스트 시드는 계정·멤버
// 행을 만들지 않는 것이 규칙이라(host-seed 시험이 merchant_members 0건을 못 박는다), 같은 검증(validateCollectibleProject)과
// 같은 발행 스냅샷(collectibleSnapshot)으로 같은 표에 직접 넣는다. 이미 게시물이 걸린 캠페인은 건드리지 않아 두 번 돌려도 같다.
import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { CollectibleArtwork, CollectibleProject } from '../collectible-project.js';
import { collectibleSnapshot, validateCollectibleProject } from '../collectible-project-rules.js';
import { storeCollectibleArt } from './store-collectible-art.js';

export type StoreCollectibleTarget = { merchantId: string; campaignId: string; storeName: string; art: keyof typeof storeCollectibleArt };

const gradeId = 'bronze';
const goalTargets = ['1', '3', '5'] as const;

function storeProject(target: StoreCollectibleTarget): CollectibleProject {
  const { image, thumbnail } = storeCollectibleArt[target.art];
  return {
    schemaVersion: 2, name: `${target.storeName} 방문 수집품`, campaignId: target.campaignId, theme: { name: '체험 방문 도감' },
    photo: { originalDataUrl: image, width: 512, height: 512 }, shape: 'circle', crop: { x: 0, y: 0, zoom: 1 },
    photoEdits: { brightness: 0, contrast: 0, merge: 0, simplify: 0, cartoon: 0, strokes: [] },
    style: 'original', baseColor: '#bf8149', photoColor: 100, relief: 45, stickers: [],
    back: { mode: 'default', color: '#bf8149', stickers: [] },
    grades: [{ id: gradeId, name: '체험', kind: 'basic', enabled: true }],
    effects: [], motion: [], thickness: 8, angle: 0,
    greeting: '시연용 가상 점포 수집품입니다.', greetingOverrides: [], audio: null,
    story: { type: 'zoom', frames: [], cartoon: 0, strength: 50 },
    parallax: { strength: 0, strokes: [] }, living: { periodMs: 2400, items: [] },
    derived: { [gradeId]: { imageDataUrl: image, thumbnailDataUrl: thumbnail } },
    rewardGrades: Object.fromEntries(goalTargets.map(goal => [goal, gradeId])),
  };
}

/** 호출자가 이미 연 거래 안에서 실행한다. 게시물이 새로 걸린 캠페인 id 목록을 돌려준다. */
export async function seedStoreCollectibles(
  client: PoolClient,
  targets: readonly StoreCollectibleTarget[],
  now: Date,
): Promise<string[]> {
  const published: string[] = [];
  for (const target of targets) {
    const linked = await client.query(
      'SELECT 1 FROM campaign_collectible_publications WHERE campaign_id = $1', [target.campaignId]);
    if (linked.rowCount) continue;
    const project = validateCollectibleProject(storeProject(target), true);
    const projectId = randomUUID();
    const publicationId = randomUUID();
    await client.query(
      `INSERT INTO collectible_projects (id, merchant_id, project, name, lineage_id, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $1, $5, $5)`,
      [projectId, target.merchantId, JSON.stringify(project), project.name, now]);
    await client.query(
      `INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, reward_grades, published_at)
       VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6)`,
      [publicationId, projectId, target.merchantId, target.campaignId, JSON.stringify(project.rewardGrades), now]);
    const { projectId: _project, publicationId: _publication, gradeId: _grade, gradeName, shape, theme, name, thumbnailDataUrl, ...detail } =
      collectibleSnapshot(project, projectId, publicationId, gradeId);
    const summary: CollectibleArtwork = { projectId, publicationId, gradeId, gradeName, shape, theme, name, thumbnailDataUrl };
    await client.query(
      'INSERT INTO collectible_publication_grades (publication_id, grade_id, summary, detail) VALUES ($1, $2, $3::jsonb, $4::jsonb)',
      [publicationId, gradeId, JSON.stringify(summary), JSON.stringify(detail)]);
    await client.query(
      'INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ($1, $2)', [target.campaignId, publicationId]);
    await client.query(
      `UPDATE collectible_projects SET status = 'PUBLISHED', publication_id = $2, version = 2, updated_at = $3 WHERE id = $1`,
      [projectId, publicationId, now]);
    published.push(target.campaignId);
  }
  return published;
}
