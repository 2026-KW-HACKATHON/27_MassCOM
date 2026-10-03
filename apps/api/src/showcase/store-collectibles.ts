// #322 시연 호스트 시드 전용: 가상 점포 A·B·C 캠페인마다 수집품 게시물 하나를 붙인다. 붙이지 않으면 보상권에 서버 그림
// (collection의 artwork)이 없어 앱이 "받은 수집품 보기"를 숨기고 봉투 연출에 들어갈 수 없다.
// 점주 편집기 경로(PostgresCollectibleProjectService.publish)는 ACTIVE 점주 계정 행을 요구하지만 호스트 시드는 계정·멤버
// 행을 만들지 않는 것이 규칙이라(host-seed 시험이 merchant_members 0건을 못 박는다), 같은 검증(validateCollectibleProject)과
// 같은 발행 스냅샷(collectibleSnapshot)으로 같은 표에 직접 넣는다.
// #333(R-333a): 목표 1·3·5회가 서로 다른 세 등급(브론즈·실버·골드)이어야 시연에서 은·금 수집품까지 볼 수 있다. 옛 시드(등급 하나 '체험')가
// 이미 걸린 시연 DB는, 그 게시물이 "시드가 직접 넣은 옛 단일 등급 게시물"일 때만 재시드가 새 3등급 게시물로 한 번 갈아 끼운다.
// 점주가 편집기로 만든 게시물은 어떤 경우에도 건드리지 않고, 이미 3등급이 걸린 캠페인은 두 번 돌려도 같다.
import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { CollectibleArtwork, CollectibleProject } from '../collectible-project.js';
import { collectibleSnapshot, validateCollectibleProject } from '../collectible-project-rules.js';
import { storeCollectibleArt } from './store-collectible-art.js';

export type StoreCollectibleTarget = { merchantId: string; campaignId: string; storeName: string; art: keyof typeof storeCollectibleArt };

export const STORE_COLLECTIBLE_GRADE_IDS = ['bronze', 'silver', 'gold'] as const;
// 목표 방문 횟수 → 등급. 서버의 보상 목표(1·3·5)와 같은 키다.
export const STORE_COLLECTIBLE_REWARD_GRADES = { 1: 'bronze', 3: 'silver', 5: 'gold' } as const;
const themeName = '체험 방문 도감';
const storeDisclosure = '시연용 가상 점포 수집품입니다.';

// 새 그림 자료를 더하지 않고, 고객 화면이 이미 등급별로 그리는 것만 다르게 한다: 등급 이름, 동작(motion → animation·motions), 인사말.
// 재질 효과(effects)는 효과 마스크 이미지가 있어야 칠해지고 모바일 앱은 읽지도 않아 쓰지 않는다. 그림은 세 등급이 같은 점포 그림이다.
const storeGrades = [
  { id: 'bronze', name: '브론즈', kind: 'basic', enabled: true },
  { id: 'silver', name: '실버', kind: 'special', enabled: true },
  { id: 'gold', name: '골드', kind: 'special', enabled: true },
] as const;
const storeMotions = [
  { id: 'motion-silver-shine', type: 'shine', gradeIds: ['silver'], playback: 'loop' },
  { id: 'motion-gold-sparkle', type: 'sparkle', gradeIds: ['gold'], playback: 'loop' },
  { id: 'motion-gold-burst', type: 'confetti', gradeIds: ['gold'], playback: 'once', particle: 'sparkles' },
] as const;
const storeGreetings = [
  { id: 'greeting-bronze', gradeIds: ['bronze'], themeName: '', text: `브론즈 수집품: 첫 방문을 축하해요. ${storeDisclosure}` },
  { id: 'greeting-silver', gradeIds: ['silver'], themeName: '', text: `실버 수집품: 세 번째 방문이에요, 단골이 되어 가고 있어요. ${storeDisclosure}` },
  { id: 'greeting-gold', gradeIds: ['gold'], themeName: '', text: `골드 수집품: 다섯 번째 방문까지 모두 채웠어요! ${storeDisclosure}` },
] as const;

const projectName = (target: StoreCollectibleTarget): string => `${target.storeName} 방문 수집품`;

// 옛 시드(#322)가 넣던 등급 배열. 이 모양과 이름·테마·빈 작성자 열이 모두 맞는 게시물만 "시드 것"으로 보고 갈아 끼운다.
const legacyGrades = [{ id: 'bronze', name: '체험', kind: 'basic', enabled: true }];

export function storeCollectibleProject(target: StoreCollectibleTarget): CollectibleProject {
  const { image, thumbnail } = storeCollectibleArt[target.art];
  return {
    schemaVersion: 2, name: projectName(target), campaignId: target.campaignId, theme: { name: themeName },
    photo: { originalDataUrl: image, width: 512, height: 512 }, shape: 'circle', crop: { x: 0, y: 0, zoom: 1 },
    photoEdits: { brightness: 0, contrast: 0, merge: 0, simplify: 0, cartoon: 0, strokes: [] },
    style: 'original', baseColor: '#bf8149', photoColor: 100, relief: 45, stickers: [],
    back: { mode: 'default', color: '#bf8149', stickers: [] },
    grades: storeGrades.map((grade) => ({ ...grade })),
    effects: [], motion: storeMotions.map((motion) => ({ ...motion, gradeIds: [...motion.gradeIds] })), thickness: 8, angle: 0,
    greeting: storeDisclosure,
    greetingOverrides: storeGreetings.map((greeting) => ({ ...greeting, gradeIds: [...greeting.gradeIds] })), audio: null,
    story: { type: 'zoom', frames: [], cartoon: 0, strength: 50 },
    parallax: { strength: 0, strokes: [] }, living: { periodMs: 2400, items: [] },
    derived: Object.fromEntries(STORE_COLLECTIBLE_GRADE_IDS.map((gradeId) => [gradeId, { imageDataUrl: image, thumbnailDataUrl: thumbnail }])),
    rewardGrades: { ...STORE_COLLECTIBLE_REWARD_GRADES },
  } as CollectibleProject;
}

/**
 * 호출자가 이미 연 거래 안에서 실행한다. 게시물이 새로 걸렸거나 옛 시드 게시물에서 3등급으로 갈아 끼워진 캠페인 id 목록을 돌려준다.
 * 이미 걸린 게시물이 점주가 만든 것이거나(작성자 열이 채워짐) 이미 3등급이면 건드리지 않는다.
 *
 * 게시·미디어 제거와 같은 점포 원본 잠금을 먼저 잡는다. 전체 시드는 이 잠금을 점포 갱신 전부터 잡아 순서를 맞춘다.
 * 동시 점주 게시와의 경합: 실제 게시(PostgresCollectibleProjectService.publish)와 같이 캠페인 행을 "연결을 읽기 전에" 무조건 FOR UPDATE로
 * 잠근다. 그래서 점주 게시가 커밋하기 전에는 이 시드가 기다리고, 커밋한 뒤에는 새 연결을 읽어 건드리지 않는다. 연결이 없을 때는 일반
 * INSERT라 (잠금이 깨진다 해도) 동시에 생긴 연결은 유일 제약 위반으로 이 거래 전체를 되돌린다 — 덮어쓰지 않는다. 옛 시드 게시물을 갈아
 * 끼울 때는 읽은 옛 게시물 id를 조건으로 건 UPDATE(비교 후 교체)이고, 한 행도 바뀌지 않으면 시드 거래 전체를 되돌리는 고정 오류를 던진다
 * (시드의 다른 실패와 같이 부분 결과를 남기지 않는다).
 */
export async function seedStoreCollectibles(
  client: PoolClient,
  targets: readonly StoreCollectibleTarget[],
  now: Date,
): Promise<string[]> {
  const published: string[] = [];
  for (const target of targets) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`collectible-sources:${target.merchantId}`]);
    await client.query('SELECT 1 FROM campaigns WHERE id = $1 FOR UPDATE', [target.campaignId]);
    const linked = await client.query<{ publication_id: string; legacy_seed: boolean }>(
      `SELECT link.publication_id,
              EXISTS (
                SELECT 1
                FROM collectible_publications AS publication
                JOIN collectible_projects AS source
                  ON source.id = publication.project_id AND source.merchant_id = publication.merchant_id
                WHERE publication.id = link.publication_id
                  AND publication.merchant_id = $2
                  AND publication.media_removed_at IS NULL
                  AND source.created_by_account_id IS NULL
                  AND source.edited_by_account_id IS NULL
                  AND source.project IS NOT NULL
                  AND source.name = $3
                  AND source.project #>> '{theme,name}' = $4
                  AND source.project -> 'grades' = $5::jsonb
              ) AS legacy_seed
       FROM campaign_collectible_publications AS link
       WHERE link.campaign_id = $1`,
      [target.campaignId, target.merchantId, projectName(target), themeName, JSON.stringify(legacyGrades)]);
    const link = linked.rows[0];
    if (link && !link.legacy_seed) continue;
    if (!link) {
      // 제거가 먼저 커밋해 연결을 지웠다면 같은 캠페인에 자동 재발행하지 않는다.
      const removed = await client.query(
        `SELECT 1 FROM collectible_publications
         WHERE merchant_id = $1 AND campaign_id = $2 AND media_removed_at IS NOT NULL LIMIT 1`,
        [target.merchantId, target.campaignId]);
      if (removed.rowCount) continue;
    }
    const project = validateCollectibleProject(storeCollectibleProject(target), true);
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
    for (const gradeId of STORE_COLLECTIBLE_GRADE_IDS) {
      const { projectId: _project, publicationId: _publication, gradeId: _grade, gradeName, shape, theme, name, thumbnailDataUrl, ...detail } =
        collectibleSnapshot(project, projectId, publicationId, gradeId);
      const summary: CollectibleArtwork = { projectId, publicationId, gradeId, gradeName, shape, theme, name, thumbnailDataUrl };
      await client.query(
        'INSERT INTO collectible_publication_grades (publication_id, grade_id, summary, detail) VALUES ($1, $2, $3::jsonb, $4::jsonb)',
        [publicationId, gradeId, JSON.stringify(summary), JSON.stringify(detail)]);
    }
    if (link) {
      const swapped = await client.query(
        'UPDATE campaign_collectible_publications SET publication_id = $3 WHERE campaign_id = $1 AND publication_id = $2',
        [target.campaignId, link.publication_id, publicationId]);
      if (swapped.rowCount !== 1) throw new Error('SHOWCASE_COLLECTIBLE_LINK_CHANGED');
    } else {
      await client.query(
        'INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ($1, $2)', [target.campaignId, publicationId]);
    }
    await client.query(
      `UPDATE collectible_projects SET status = 'PUBLISHED', publication_id = $2, version = 2, updated_at = $3 WHERE id = $1`,
      [projectId, publicationId, now]);
    published.push(target.campaignId);
  }
  return published;
}
