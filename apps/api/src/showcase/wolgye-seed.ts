import type { PoolClient } from 'pg';

import { validateRealWorldProfile } from '../real-world-rules.js';
import { SHOWCASE_SEED_CAMPAIGN_BACKDATE_DAYS } from './all-access.js';
import { seedStoreCollectibles, type StoreCollectibleTarget } from './store-collectibles.js';
import data from './wolgye-stores.json' with { type: 'json' };

export const WOLGYE_STORES = data.stores;
export const WOLGYE_STORE_DISCLOSURE = '실제 가게 정보(소상공인시장진흥공단 상가정보, 2026-06-30 기준)로 만든 시연 점포예요. 이 가게는 MassCOM에 참여하지 않았어요.';
export const WOLGYE_PRISM_STORE = WOLGYE_STORES[0]!;
export const WOLGYE_COURSE_STORES = WOLGYE_STORES.slice(0, 3);

const artByCategory: Record<string, StoreCollectibleTarget['art']> = {
  카페: 'a', 베이커리: 'a', 분식: 'b', 기타: 'b',
  한식: 'c', 중식: 'c', 일식: 'c', 양식: 'c', 주점: 'c',
};

// 호출자는 기존 시연 DB 이름 검사·시드 잠금·거래를 먼저 확보한다. 점포 충돌은 전체 시드를 되돌린다.
export async function seedWolgyeStores(client: PoolClient, now: Date): Promise<void> {
  const startsAt = new Date(now.getTime() - SHOWCASE_SEED_CAMPAIGN_BACKDATE_DAYS * 86_400_000);
  const endsAt = new Date(now.getTime() + 30 * 86_400_000);
  const targets: StoreCollectibleTarget[] = [];
  for (const store of WOLGYE_STORES) {
    const campaignId = `${store.id}-campaign`;
    const profile = validateRealWorldProfile({
      location: {
        building: { latitude: store.lat, longitude: store.lng }, entrance: null,
        floor: null, unit: null, entranceNote: null, source: 'ADMIN_DOCUMENTED',
        verificationNote: `${data.attribution}; SEMAS ${store.sourceId}; 현재 영업 여부 미확인`,
        verifiedAt: `${store.dataDate}T00:00:00Z`,
      },
      schedule: null, todayOverride: null, menuItems: [], visitInstructions: '',
      contact: { phone: null, website: null },
    });
    await client.query(
      `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo, neighborhood, category, published_at)
       VALUES ($1, $2, $3, $4, 0, 'ACTIVE', true, '월계동', $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [store.id, store.name, WOLGYE_STORE_DISCLOSURE, store.roadAddress, store.category, now]);
    await client.query(
      `INSERT INTO merchant_real_world_profiles (merchant_id, profile, latitude, longitude, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5) ON CONFLICT (merchant_id) DO NOTHING`,
      [store.id, JSON.stringify(profile), store.lat, store.lng, now]);
    const matching = await client.query(
      `SELECT 1 FROM merchants m JOIN merchant_real_world_profiles p ON p.merchant_id = m.id
       WHERE m.id = $1 AND m.name = $2 AND m.story = $3 AND m.road_address = $4
         AND m.category = $5 AND m.neighborhood = '월계동' AND m.status = 'ACTIVE' AND m.is_demo
         AND m.published_at IS NOT NULL AND m.minimum_spend_won = 0
         AND m.menu_items = '[]'::jsonb AND m.business_hours = ''
         AND p.profile = $6::jsonb AND p.latitude = $7 AND p.longitude = $8`,
      [store.id, store.name, WOLGYE_STORE_DISCLOSURE, store.roadAddress, store.category,
        JSON.stringify(profile), store.lat, store.lng]);
    if (matching.rowCount !== 1) throw new Error('SHOWCASE_WOLGYE_FIXTURE_COLLISION');

    await client.query(
      `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity, enrolled_count)
       VALUES ($1, $2, '체험 방문 도감', $3, $4, 'ACTIVE', true, 20, 0)
       ON CONFLICT (id) DO NOTHING`, [campaignId, store.id, startsAt, endsAt]);
    for (const [count, name] of [[1, '가상 첫 방문 수집품'], [3, '가상 세 번째 방문 수집품'], [5, '가상 다섯 번째 방문 수집품']]) {
      await client.query(
        `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
         VALUES ($1, $2, $3) ON CONFLICT (campaign_id, target_visit_count) DO NOTHING`,
        [campaignId, count, name]);
    }
    const campaign = await client.query(
      `SELECT 1 FROM campaigns c WHERE c.id = $1 AND c.merchant_id = $2
         AND c.title = '체험 방문 도감' AND c.status = 'ACTIVE' AND c.is_public
         AND c.enrollment_capacity = 20 AND c.enrolled_count BETWEEN 0 AND 20
         AND (SELECT jsonb_agg(jsonb_build_array(g.target_visit_count, g.display_name) ORDER BY g.target_visit_count)
              FROM campaign_goals g WHERE g.campaign_id = c.id) = $3::jsonb`,
      [campaignId, store.id, JSON.stringify([[1, '가상 첫 방문 수집품'], [3, '가상 세 번째 방문 수집품'], [5, '가상 다섯 번째 방문 수집품']])]);
    if (campaign.rowCount !== 1) throw new Error('SHOWCASE_WOLGYE_FIXTURE_COLLISION');
    await client.query(
      `UPDATE campaigns SET starts_at = LEAST(starts_at, $2), ends_at = GREATEST(ends_at, $3)
       WHERE id = $1 AND (starts_at > $2 OR ends_at < $3)`, [campaignId, startsAt, endsAt]);
    targets.push({
      merchantId: store.id, campaignId, storeName: store.name,
      art: artByCategory[store.category] ?? 'b',
      ...(store.id === WOLGYE_PRISM_STORE.id ? { topGrade: 'prism' as const } : {}),
    });
  }
  await seedStoreCollectibles(client, targets, now);
}
