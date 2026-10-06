import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import { createRouteRequestGate, routePlanKey } from './route-request';

test('deferred A cannot display after origin or course changes and B starts', async()=>{
  const gate=createRouteRequestGate();const a=new AbortController();
  const keyA=routePlanKey({latitude:37.61,longitude:127.04,basis:'MANUAL'},[{merchantId:'a',dwellMinutes:15}]);
  const tokenA=gate.begin(a,keyA);
  gate.invalidate();assert.equal(a.signal.aborted,true);
  const b=new AbortController();const keyB=routePlanKey({latitude:37.62,longitude:127.05,basis:'MANUAL'},[{merchantId:'b',dwellMinutes:25}]);
  const tokenB=gate.begin(b,keyB);
  await Promise.resolve();
  assert.equal(gate.isCurrent(tokenA,keyA),false);
  assert.equal(gate.isCurrent(tokenB,keyB),true);
  assert.equal(gate.isCurrent(tokenB,keyA),false);
  gate.invalidate();assert.equal(b.signal.aborted,true);
});


test('screen aborts old walk requests on course and origin edits and checks generation after both awaits',()=>{
  const source=readFileSync(new URL('./index.tsx',import.meta.url),'utf8');
  assert.match(source,/function updateCourse\(next:CourseStop\[\]\) \{routeGate\.invalidate\(\)/);
  assert.match(source,/return discoveryState\.subscribe\(\(\)=>\{const latest/);
  assert.match(source,/routeGate\.begin\(controller,key\)/);
  assert.match(source,/routeGate\.isCurrent\(token,routePlanKey/);
  assert.match(source,/const details=await fetchCourseDetails[\s\S]*?if\(!current\(\)\)return;[\s\S]*?const result=await api\.walk[\s\S]*?if\(current\(\)\)/);
});
