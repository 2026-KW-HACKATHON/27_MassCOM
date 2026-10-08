import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
const source=readFileSync(new URL('./index.tsx',import.meta.url),'utf8');
test('detail loads its own ID and keeps ended campaigns visible',()=>{
  assert.match(source,/api\.merchant\(merchantId\)/);assert.doesNotMatch(source,/useMerchantCatalog/);
  assert.match(source,/campaignLabel\(campaign\.state\)/);assert.match(source,/현재 진행 중인 캠페인이 없습니다/);
});
test('real photos, schedule, entrance, AI collectible art, feedback and claim are distinct',()=>{
  for(const part of ['점주 제공 실제 사진','입구','요일별 시간','AI 생성 수집품 그림','MyVisitorFeedback',"pathname:'/claim'"]) assert.match(source,new RegExp(part));
  assert.match(source,/merchantId:merchant\.id/);
});


test('verified coordinates open documented walking destination and exact collectible goal saves only with publication link',()=>{
  assert.match(source,/coordinateWalkTargets\(\{name:merchant\.name,destination/);
  assert.match(source,/merchant\.location\?\.entrance\?\?merchant\.position/);
  assert.match(source,/saveCollectibleGoal\(studioApi/);
  assert.match(source,/preview\.publicationId/);
  assert.match(source,/campaign\.state!=='ACTIVE'/);
});


test('open state can separately show last-order closure without a closed-shop label',()=>{
  assert.match(source,/businessLabel\(merchant\.business\)/);
  assert.match(source,/merchant\.business\.lastOrderAt\?<Line label="마지막 주문 시각"/);
  assert.match(source,/day\.periods\.map\(openingPeriodLabel\)/);
  assert.match(source,/exception\.periods\.map\(openingPeriodLabel\)/);
});

test('leaving during goal save releases the disabled button while stale save completions stay fenced',()=>{
  assert.match(source,/useFocusEffect\(useCallback\(\(\)=>\{if\(!foreground\)return;void refresh\(\);return\(\)=>\{generation\.current\+\+;goalGeneration\.current\+\+;setGoalBusy\(false\);setBenefitBusy\(false\);\}/);
  assert.match(source,/\[refresh,foreground\]\)/);
  assert.match(source,/finally\{if\(goalGeneration\.current===current\)setGoalBusy\(false\);\}/);
});

test('campaign benefit appears only from an account-backed response and claims through its own endpoint',()=>{
  assert.match(source,/credential\?createBadgeApiClient/);
  assert.match(source,/items\.find\(item=>item\.campaignId===detail\.campaign\?\.id\)/);
  assert.match(source,/benefitApi\.claimCampaignBenefit\(benefit\.benefitId\)/);
  for(const copy of ['혜택 받기','받을 수 있음','모두 소진','내 쿠폰 보기']) assert.match(source,new RegExp(copy));
  assert.doesNotMatch(source,/unitExtraCostWon|maxUses|issuedCount/);
});

test('authenticated detail adds an optional ACTIVE-course merchant chip without surfacing course failures',()=>{
  assert.match(source,/createCourseApiClient\(\{apiUrl,credential,onSessionInvalid\}\)\.list\(controller\.signal\)/);
  assert.match(source,/merchantCourseChip\(\[course\],merchantId\)/);
  assert.match(source,/\.catch\(\(\)=>undefined\)/);
  assert.match(source,/courseChip\?<Pressable accessibilityRole="button"/);
  assert.match(source,/pathname:'\/courses\/\[courseId\]',params:\{courseId:courseChip\.id\}/);
  assert.match(source, /merchant\.distance\?\.meters\?\?straightLineMeters\(discoveryState\.snapshot\(\)\.origin,merchant\.position\)/);
});
