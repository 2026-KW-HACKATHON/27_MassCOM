import type { PoolClient } from 'pg';

export type GrantedGoal = {
  entitlementId: string;
  targetVisitCount: 1 | 3 | 5;
  claimExpiresAt: Date;
};

// 세어지는 방문 수(progressVisitCount)가 닿은 목표 중 취소되지 않은 권리가 없는 것에 새 권리를 준다.
// 방문 수령과 방문 취소(승격 뒤 다시 채우기)가 같은 규칙을 쓰도록 한 곳에 둔다. 호출자가 [고객, 캠페인] 잠금을 잡고 있어야 한다.
// 취소된(CANCELED) 권리는 감사 기록일 뿐이라 같은 목표를 다시 채우면 새 권리가 생긴다(부분 제외 제약 reward_entitlements_unique_goal).
// 제외 제약은 열 목록으로 추론할 수 없고 DO UPDATE도 못 받으므로 제약 이름으로 DO NOTHING만 쓴다(옛 API와 같은 문장).
export async function grantReachedGoals(
  client: PoolClient,
  input: {
    accountId: string;
    campaignId: string;
    progressVisitCount: number;
    sourceVisitEventId: string;
    now: Date;
    claimExpiresAt: Date;
    nextEntitlementId: () => string;
  },
): Promise<GrantedGoal[]> {
  const goals = await client.query<{ target_visit_count: 1 | 3 | 5 }>(
    `SELECT goal.target_visit_count
     FROM campaign_goals AS goal
     LEFT JOIN reward_entitlements AS entitlement
       ON entitlement.customer_account_id = $1
      AND entitlement.campaign_id = goal.campaign_id
      AND entitlement.target_visit_count = goal.target_visit_count
      AND entitlement.status <> 'CANCELED'
     WHERE goal.campaign_id = $2
       AND goal.target_visit_count <= $3
       AND entitlement.id IS NULL
     ORDER BY goal.target_visit_count`,
    [input.accountId, input.campaignId, input.progressVisitCount],
  );
  const granted: GrantedGoal[] = [];
  for (const goal of goals.rows) {
    const inserted = await client.query<{ id: string; target_visit_count: 1 | 3 | 5; claim_expires_at: Date }>(
      `INSERT INTO reward_entitlements (
         id,
         customer_account_id,
         campaign_id,
         target_visit_count,
         source_visit_event_id,
         status,
         policy_version,
         earned_at,
         claim_expires_at,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'GRANTED', 'VISIT_1_3_5_KST_DAILY_V1', $6, $7, $6, $6)
       ON CONFLICT ON CONSTRAINT reward_entitlements_unique_goal DO NOTHING
       RETURNING id, target_visit_count, claim_expires_at`,
      [
        input.nextEntitlementId(),
        input.accountId,
        input.campaignId,
        goal.target_visit_count,
        input.sourceVisitEventId,
        input.now,
        input.claimExpiresAt,
      ],
    );
    const row = inserted.rows[0];
    if (row) {
      granted.push({
        entitlementId: row.id,
        targetVisitCount: row.target_visit_count,
        claimExpiresAt: row.claim_expires_at,
      });
    }
  }
  return granted;
}
