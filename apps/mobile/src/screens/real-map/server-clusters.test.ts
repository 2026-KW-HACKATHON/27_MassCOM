import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import { clusterMarkerId, clusterQueryBounds, markersForDiscovery } from './server-clusters';
import type { MapCluster, MerchantSummary } from '../../../../api/src/real-world-contract';

const make=(id:string,count:number,latitude:number,longitude:number):MapCluster=>({id,position:{latitude,longitude},count,bounds:{south:latitude,north:latitude,west:longitude,east:longitude}});
const merchant=(id:string,latitude:number,longitude:number):MerchantSummary=>({id,name:id,roadAddress:'도로',category:null,demo:false,profileVersion:1,position:{latitude,longitude},positionBasis:'OWNED',positionExpiresAt:null,floor:null,entranceNote:null,thumbnail:null,business:{state:'OPEN',basis:'SCHEDULE',evaluatedAt:'2026-10-06T00:00:00Z',nextChangeAt:null,informationUpdatedAt:null,acceptingOrders:true,lastOrderAt:null},campaign:null,distance:null});
test('server count covers 45 shops although only first 40 are loaded',()=>{
  const group=make('cell:1',45,37.6,127.0);
  const markers=markersForDiscovery([group],Array.from({length:40},(_,i)=>merchant(String(i),37.6,127.0)),new Set());
  assert.deepEqual(markers.map(m=>[m.id,m.count]),[[clusterMarkerId(group.id),45]]);
});
test('different-position one-shop cells remain separate and leaf query includes bounds',()=>{
  const a=make('cell:a',1,37.6,127.0),b=make('cell:b',1,37.6003,127.0003);
  const markers=markersForDiscovery([a,b],[],new Set());
  assert.deepEqual(markers.map(m=>m.id),[clusterMarkerId(a.id),clusterMarkerId(b.id)]);
  const query=clusterQueryBounds(a.bounds);
  assert.ok(query.south<a.bounds.south&&query.north>a.bounds.north&&query.west<a.bounds.west&&query.east>a.bounds.east);
});
test('loaded singleton keeps its merchant marker, while unrelated loaded stores do not duplicate a cluster',()=>{
  const a=make('cell:a',1,37.6,127);
  assert.deepEqual(markersForDiscovery([a],[merchant('shop',37.6,127)],new Set()).map(m=>m.id),['shop']);
});


test('screen renders all server clusters and pages selected leaves by cluster ID',()=>{
  const source=readFileSync(new URL('./index.tsx',import.meta.url),'utf8');
  assert.match(source,/markersForDiscovery\(state\.clusters,visible,visited\)/);
  assert.match(source,/clusterMarkerId\(item\.id\)===id/);
  assert.match(source,/loadClusterPage\(cluster\)/);
  assert.match(source,/api\.search\(\{\.\.\.query,cursor\},controller\.signal\)/);
  assert.match(source,/loadClusterPage\(selectedCluster,clusterPage\.nextCursor!,clusterPage\.query\)/);
  assert.match(source,/selectedCluster\.count/);
});


test('leaf pagination reuses its first query when the camera changes',()=>{
  const source=readFileSync(new URL('./index.tsx',import.meta.url),'utf8');
  assert.match(source,/const query:DiscoveryQuery=baseQuery\?\?/);
  assert.match(source,/api\.search\(\{\.\.\.query,cursor\},controller\.signal\)/);
  assert.match(source,/clusterPage\.query/);
});
test('cluster leaf bounds stay inside the original zoom cell and searched viewport',()=>{
  const zoom=14,scale=2**zoom,lat=37.6,lon=127;
  const y=Math.floor(lat*scale/180),x=Math.floor(lon*scale/360);
  const scope={south:37.59,north:37.61,west:126.99,east:127.01};
  const a=clusterQueryBounds(make(`cluster:${y}:${x}`,3,lat,lon).bounds,`cluster:${y}:${x}`,zoom,scope);
  const b=clusterQueryBounds(make(`cluster:${y}:${x+1}`,2,lat,lon+0.01).bounds,`cluster:${y}:${x+1}`,zoom,scope);
  assert.ok(a.south>=scope.south&&a.north<=scope.north&&a.west>=scope.west&&a.east<=scope.east);
  assert.ok(a.east<b.west,'neighboring server cells do not leak into one another');
});
