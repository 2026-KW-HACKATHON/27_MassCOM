import type { PoolClient } from 'pg';

import { MerchantAccessError, type MerchantRole } from '../merchant-access.js';

export type ActiveMerchantMember = { role: MerchantRole; merchantStatus: string };

// 트랜잭션 안에서 계정이 지금도 이 가게의 활성 멤버인지 확인하고 역할을 돌려준다(아니면 MERCHANT_ACCESS_DENIED).
// 잠금 순서: 가게 행 FOR SHARE가 먼저다. 점주 내리기·직원 회수(admin.ts, staff-registration.ts)는 가게 행 FOR UPDATE를 먼저 잡고
// merchant_members를 바꾸므로, 이 확인은 그 트랜잭션이 끝난 뒤의 결과를 보고 이 트랜잭션이 끝날 때까지 뒤이은 회수를 기다리게 한다.
// 가게 행 잠금과 멤버십 읽기는 문장을 나눈다: READ COMMITTED의 스냅샷은 문장 시작 때 정해지므로 한 문장으로 합치면
// 잠금을 기다린 사이에 커밋된 회수를 못 보고 옛 멤버십으로 통과한다.
// 주의: 계정 삭제(account-deletion.ts)는 가게 행을 잠그지 않고 merchant_members를 회수하므로 이 함수의 잠금으로는 직렬화되지 않는다.
// 호출자가 그보다 먼저 accountLifecycle.assertActive(계정 advisory 잠금)를 잡아야 삭제와 엇갈리지 않는다(그림 변경·되돌리기·발급이 그렇게 한다).
export async function requireActiveMerchantMember(
  client: PoolClient, merchantId: string, accountId: string,
  permission?: 'CONFIRM_VISIT' | 'REDEEM_COUPON' | 'SCAN_CUSTOMER',
): Promise<ActiveMerchantMember> {
  const merchant = await client.query<{ status: string; is_demo: boolean }>(
    'SELECT status, is_demo FROM merchants WHERE id = $1 FOR SHARE', [merchantId],
  );
  // 월계 공공데이터 점포는 방문 대상일 뿐 관리 대상이 아니다. 오래된 멤버십도 권한이 되지 않는다.
  if (merchant.rows[0]?.is_demo && merchantId.startsWith('showcase-wolgye-')) {
    throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
  }
  const member = await client.query<{ role: MerchantRole }>(
    `SELECT role FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 AND status = 'ACTIVE'
       AND ($3::text IS NULL OR role = 'OWNER'
         OR ($3 = 'CONFIRM_VISIT' AND staff_can_confirm_visit)
         OR ($3 = 'SCAN_CUSTOMER' AND (staff_can_confirm_visit OR staff_can_redeem_coupon))
         OR ($3 = 'REDEEM_COUPON' AND staff_can_redeem_coupon))`,
    [merchantId, accountId, permission ?? null],
  );
  if (!merchant.rows[0] || !member.rows[0]) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
  return { role: member.rows[0].role, merchantStatus: merchant.rows[0].status };
}
