// 운영자 퍼널의 집계값만 응답한다. 열람은 개인 방문과 연결하지 않는다.
export type AdminFunnelMerchant = {
  merchantId: string;
  name: string;
  detailViews: number;
  countedVisits: number;
  uniqueVisitors: number;
  repeatVisitors: number;
  couponsIssued: number;
  couponsRedeemed: number;
  collectiblesAcquired: number;
};

export type AdminFunnel = {
  from: string;
  to: string;
  days: number;
  totals: {
    detailViews: number;
    countedVisits: number;
    newVisitors: number;
    newVisitorsWithSecondStore: number;
    repeatVisitors: number;
  };
  merchants: AdminFunnelMerchant[];
};

export interface AdminFunnelReader {
  funnel(days: number): Promise<AdminFunnel>;
}
