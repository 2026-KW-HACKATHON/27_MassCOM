import assert from 'node:assert/strict';
import test from 'node:test';
import { businessLabel, campaignLabel, enrollmentLabel, photoKindLabel, routeWarningLabel, openingPeriodLabel } from './real-world-labels';

test('business state distinguishes schedule from owner temporary status and unknown',()=>{
  assert.equal(businessLabel({state:'OPEN',basis:'SCHEDULE'}),'영업 중 · 시간표 기준');
  assert.equal(businessLabel({state:'OPEN',basis:'OWNER_OVERRIDE'}),'영업 중 · 점주 임시 안내');
  assert.equal(businessLabel({state:'UNKNOWN',basis:'UNKNOWN'}),'영업 상태 미확인');
});
test('campaign, enrollment, photo and route codes use Korean copy',()=>{
  assert.equal(campaignLabel('ENDED'),'종료');assert.equal(enrollmentLabel('FULL'),'참여 정원 도달');
  assert.equal(photoKindLabel('ENTRANCE'),'입구');assert.equal(routeWarningLabel('CLOSED_AT_ARRIVAL'),'도착 예상 시 영업 종료');
});
test('open but past last order remains open and names the order boundary',()=>{
  assert.equal(businessLabel({state:'OPEN',basis:'SCHEDULE',acceptingOrders:false}),'영업 중 · 주문 마감 · 시간표 기준');
  assert.equal(routeWarningLabel('ORDER_CLOSED'),'도착 예상 시 주문 마감');
});
test('opening period keeps last-order minute separate from closing time',()=>{
  assert.equal(openingPeriodLabel({startMinute:600,endMinute:1260,lastOrderMinute:1200}),'10:00–21:00 · 마지막 주문 20:00');
  assert.equal(openingPeriodLabel({startMinute:1320,endMinute:1560,lastOrderMinute:1500}),'22:00–02:00 다음날 · 마지막 주문 01:00 다음날');
});
