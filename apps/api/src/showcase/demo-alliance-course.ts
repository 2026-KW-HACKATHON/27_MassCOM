import type { PoolClient } from 'pg';

import { WOLGYE_STORES } from './wolgye-seed.js';

export const SHOWCASE_DEMO_ALLIANCE_COURSE_ID = '2f5cb61a-8a61-48b9-a343-9aa0eb363daa';
const storeIds = [
  'showcase-wolgye-MA010120220804358835',
  'showcase-wolgye-MA0101202210A0010909',
  'showcase-wolgye-MA0101202411A0001948',
] as const;
export const SHOWCASE_DEMO_ALLIANCE_STORES = storeIds.map(id => {
  const store = WOLGYE_STORES.find(item => item.id === id);
  if (!store) throw new Error('SHOWCASE_DEMO_COURSE_STORES_MISSING');
  return store;
});
const title = '시연 연합 미션 · 월계동 세 가게';
const pieces = ['시연 첫 조각', '시연 둘째 조각', '시연 셋째 조각'] as const;

// 호출자는 시연 DB 이름 검사와 전체 시드 거래·잠금을 이미 확보한다.
export async function seedDemoAllianceCourse(client: PoolClient, now: Date): Promise<void> {
  await client.query(
    `INSERT INTO courses(id, title, situation, scene_key, status, curated_by_account_id, checked_at, check_summary)
     VALUES ($1, $2, 'AFTER_MEAL', 'showcase-picnic', 'DRAFT', 'showcase-fixture', $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [SHOWCASE_DEMO_ALLIANCE_COURSE_ID, title, now,
      JSON.stringify({ schemaVersion: 1, snapshot: true, label: '시연 데이터 · 실제 가게 참여나 혜택 아님' })],
  );
  for (const [index, store] of SHOWCASE_DEMO_ALLIANCE_STORES.entries()) {
    await client.query(
      `INSERT INTO course_steps(course_id, position, merchant_id, target_visit_count, piece_key,
       piece_label, owner_optin_ref, owner_optin_at)
       SELECT $1, $2, $3, 1, $4, $5, 'SHOWCASE-DEMO-ONLY', $6
       WHERE EXISTS (SELECT 1 FROM courses WHERE id = $1 AND status = 'DRAFT')
       ON CONFLICT (course_id, position) DO NOTHING`,
      [SHOWCASE_DEMO_ALLIANCE_COURSE_ID, index + 1, store.id, `demo-piece-${index + 1}`, pieces[index], now],
    );
  }
  await client.query("UPDATE courses SET status = 'ACTIVE' WHERE id = $1 AND status = 'DRAFT'", [SHOWCASE_DEMO_ALLIANCE_COURSE_ID]);
  const course = await client.query<{ title: string; status: string; merchant_ids: string[]; goals: number[] }>(
    `SELECT course.title, course.status,
       array_agg(step.merchant_id ORDER BY step.position) AS merchant_ids,
       array_agg(step.target_visit_count ORDER BY step.position) AS goals
     FROM courses course JOIN course_steps step ON step.course_id = course.id
     WHERE course.id = $1 GROUP BY course.id`, [SHOWCASE_DEMO_ALLIANCE_COURSE_ID]);
  if (course.rows[0]?.title !== title || course.rows[0].status !== 'ACTIVE' ||
      JSON.stringify(course.rows[0].merchant_ids) !== JSON.stringify(SHOWCASE_DEMO_ALLIANCE_STORES.map(store => store.id)) ||
      JSON.stringify(course.rows[0].goals) !== JSON.stringify([1, 1, 1])) {
    throw new Error('SHOWCASE_DEMO_COURSE_FIXTURE_COLLISION');
  }
}
