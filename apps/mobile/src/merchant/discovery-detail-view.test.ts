import assert from 'node:assert/strict';
import test from 'node:test';
import { sendDiscoveryDetailView } from './discovery-detail-view';

test('detail event sends once per shop and KST day within an app session',async()=>{
  const events:unknown[]=[];let uuid=0;
  const api={event:async(value:unknown)=>{events.push(value);return {};}};
  const makeId=()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`;
  await sendDiscoveryDetailView(api,'shop-dedupe','friend',makeId,new Date('2026-10-03T14:59:00Z'));
  await sendDiscoveryDetailView(api,'shop-dedupe','map',makeId,new Date('2026-10-03T14:59:30Z'));
  await sendDiscoveryDetailView(api,'shop-dedupe','map',makeId,new Date('2026-10-03T15:01:00Z'));
  assert.equal(events.length,2);assert.equal(uuid,2);
  assert.deepEqual(events.map((event:any)=>[event.event,event.merchantId,event.source]),[['DETAIL_VIEW','shop-dedupe','friend'],['DETAIL_VIEW','shop-dedupe','map']]);
  assert.doesNotMatch(JSON.stringify(events),/latitude|query|accountId|geometry/);
});
