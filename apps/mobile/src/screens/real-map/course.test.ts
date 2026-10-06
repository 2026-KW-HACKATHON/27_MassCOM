import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createCourse, moveStop, replaceStop, recommendStops, setDwell, serializeCourse, restoreCourse, buildWalkingRouteInput, fetchCourseDetails } from './course';
import type { MerchantDetail, MerchantSummary } from '../../../../api/src/real-world-contract';

const base: MerchantSummary = {id:'a',name:'A',roadAddress:'address',category:null,demo:false,profileVersion:1,position:{latitude:37.6,longitude:127},positionBasis:'OWNED',positionExpiresAt:null,floor:null,entranceNote:null,thumbnail:null,business:{state:'OPEN',basis:'SCHEDULE',evaluatedAt:'2026-10-06T00:00:00Z',nextChangeAt:null,informationUpdatedAt:null,acceptingOrders:true,lastOrderAt:null},campaign:null,distance:{meters:100,kind:'STRAIGHT_LINE',origin:'MANUAL'}};
test('course recommendations favor interests and unvisited eligible shops; never include unlocated shops',()=>{
  const stops=recommendStops([base,{...base,id:'b',position:null},{...base,id:'c',distance:{...base.distance!,meters:20}}],new Set(['a']),new Set(['c']));
  assert.deepEqual(stops.map(x=>x.id),['c','a']);
});
test('course order, replacement and dwell are editable; storage keeps only IDs/order/dwell',()=>{
  let course=createCourse(['a','b']); course=moveStop(course,1,0);course=replaceStop(course,1,'c');course=setDwell(course,0,25);
  assert.deepEqual(course,[{merchantId:'b',dwellMinutes:25},{merchantId:'c',dwellMinutes:15}]);
  const saved=serializeCourse(course);assert.deepEqual(restoreCourse(saved),course);assert.doesNotMatch(saved,/latitude|geometry|origin/);
});
test('recommendations put a saved collectible goal and eligible open shops ahead of distance-only picks',()=>{
  const campaign={id:'c',title:'c',startsAt:'2026-10-06T00:00:00Z',endsAt:'2026-10-07T00:00:00Z',state:'ACTIVE' as const,enrollment:'OPEN' as const,rewardAvailability:'AVAILABLE' as const,goals:[{targetVisitCount:3 as const,displayName:'goal'}]};
  const shops=[{...base,id:'near',distance:{...base.distance!,meters:10},campaign:null},{...base,id:'goal',distance:{...base.distance!,meters:100},campaign},{...base,id:'closed',business:{...base.business,state:'CLOSED' as const},campaign}];
  assert.deepEqual(recommendStops(shops,new Set(),new Set(['goal']),new Map([['goal',1]])).map(m=>m.id),['goal','near']);
});


test('unverified and break-time business states are not recommended as immediately visitable',()=>{
  assert.deepEqual(recommendStops([{...base,id:'unknown',business:{...base.business,state:'UNKNOWN'}},{...base,id:'break',business:{...base.business,state:'BREAK'}},base],new Set(),new Set()).map(m=>m.id),['a']);
});
test('older saved course drops coordinates, route geometry, invalid and repeated stops',()=>{
  const old=JSON.stringify([{merchantId:'a',dwellMinutes:20,origin:{latitude:37.6,longitude:127},geometry:[[127,37.6]]},{merchantId:'a',dwellMinutes:30},{merchantId:'b',dwellMinutes:15},{merchantId:'bad',dwellMinutes:500}]);
  assert.deepEqual(restoreCourse(old),[{merchantId:'a',dwellMinutes:20},{merchantId:'b',dwellMinutes:15}]);
});


test('walking request producer strips discovery origin basis from the exact wire body',()=>{
  const selectedOrigin={latitude:37.62,longitude:127.05,basis:'CURRENT_LOCATION'};
  const input=buildWalkingRouteInput(selectedOrigin,[{merchantId:'a',dwellMinutes:15}], '2026-10-06T00:00:00Z');
  assert.deepEqual(input,{origin:{latitude:37.62,longitude:127.05},merchantIds:['a'],departureAt:'2026-10-06T00:00:00Z',dwellMinutes:[15]});
  assert.doesNotMatch(JSON.stringify(input),/basis|CURRENT_LOCATION/);
  const screen=readFileSync(new URL('./index.tsx',import.meta.url),'utf8');
  assert.match(screen,/api\.walk\(buildWalkingRouteInput\(origin,planned/);
});


test('saved course resolves each ID independently of the current viewport page',async()=>{
  const asked:string[]=[];
  const details=await fetchCourseDetails([{merchantId:'pan-away-a',dwellMinutes:15},{merchantId:'pan-away-b',dwellMinutes:25}],async id=>{asked.push(id);return {...base,id} as unknown as MerchantDetail;});
  assert.deepEqual(asked,['pan-away-a','pan-away-b']);
  assert.deepEqual(details.map(item=>item.id),asked);
  const screen=readFileSync(new URL('./index.tsx',import.meta.url),'utf8');
  assert.match(screen,/fetchCourseDetails\(planned,api\.merchant,controller\.signal\)/);
  assert.doesNotMatch(screen.slice(screen.indexOf('async function calculateRoute()'),screen.indexOf('const button=')),/state\.merchants\.find/);
});
