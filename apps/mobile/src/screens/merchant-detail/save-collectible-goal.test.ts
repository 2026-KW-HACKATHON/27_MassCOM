import assert from 'node:assert/strict';
import test from 'node:test';
import { saveCollectibleGoal } from './save-collectible-goal';

const studio={theme:'daylight' as const,layout:'shelf' as const,accent:'mint' as const,slots:[],goal:null};
test('saves exact linked collectible on the latest studio snapshot',async()=>{
  let saved:any;const api={getMine:async()=>({studio}),save:async(value:any)=>{saved=value;return {studio:value};}};
  const okay=await saveCollectibleGoal(api,{merchantId:'m',campaignId:'c',publicationId:'p',targetVisitCount:3},()=>true);
  assert.equal(okay,true);assert.deepEqual(saved.goal,{kind:'collectible',merchantId:'m',campaignId:'c',publicationId:'p',targetVisitCount:3});
});
test('late account transition after getMine never writes the old account studio',async()=>{
  let finish!: (value:{studio:typeof studio})=>void;let active=true;let saved=false;
  const api={getMine:()=>new Promise<{studio:typeof studio}>(resolve=>{finish=resolve;}),save:async()=>{saved=true;return {studio};}};
  const pending=saveCollectibleGoal(api,{merchantId:'m',campaignId:'c',publicationId:'p',targetVisitCount:1},()=>active);
  active=false;finish({studio});
  assert.equal(await pending,false);assert.equal(saved,false);
});
