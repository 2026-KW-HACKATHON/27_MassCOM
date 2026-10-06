import assert from 'node:assert/strict';
import test from 'node:test';
import { createDiscoveryApiClient, DiscoveryApiError } from './discovery-api';

const client = (fetcher: typeof fetch) => createDiscoveryApiClient({apiUrl:'https://api.example',fetcher});

test('search uses POST body and accepts empty real shops without a synthetic fallback', async () => {
  const calls: {url:string; init:RequestInit}[]=[];
  const api=client((async (url,init) => {calls.push({url:String(url),init:init!});return Response.json({schemaVersion:1,asOf:'2026-10-06T00:00:00Z',merchants:[],clusters:[],nextCursor:null,unlocatedCount:2});}) as typeof fetch);
  const page=await api.search({bounds:{west:127,south:37,east:128,north:38},zoom:12,query:'cake'});
  assert.equal(page.merchants.length,0);assert.equal(page.unlocatedCount,2);
  assert.equal(calls[0].url,'https://api.example/v1/discovery/search');
  assert.equal(calls[0].init.method,'POST');assert.match(String(calls[0].init.body),/"query":"cake"/);
});

test('detail is fetched by encoded ID and 404 is preserved', async () => {
  const urls:string[]=[];
  const api=client((async url=>{urls.push(String(url));return Response.json({code:'NOT_FOUND'},{status:404});}) as typeof fetch);
  await assert.rejects(api.merchant('a/b'),(e:unknown)=>e instanceof DiscoveryApiError && e.status===404);
  assert.equal(urls[0],'https://api.example/v1/discovery/merchants/a%2Fb');
});

test('walking errors do not produce straight-line geometry', async () => {
  const api=client((async()=>Response.json({code:'MAP_NOT_CONFIGURED'},{status:503})) as typeof fetch);
  await assert.rejects(api.walk({origin:{latitude:37.6,longitude:127},merchantIds:['a'],departureAt:'2026-10-06T00:00:00Z',dwellMinutes:[15]}),
    (e:unknown)=>e instanceof DiscoveryApiError && e.code==='MAP_NOT_CONFIGURED');
});

test('merchant media only resolves published photo paths on the configured API origin', async () => {
  const { publishedPhotoUri } = await import('./discovery-api');
  assert.equal(publishedPhotoUri('https://api.example','/v1/discovery/photos/'+'a'.repeat(64)),'https://api.example/v1/discovery/photos/'+'a'.repeat(64));
  for (const value of ['https://evil.example/a','//evil.example/a','/v1/discovery/photos/../../a','/v1/discovery/photos/x']) assert.equal(publishedPhotoUri('https://api.example',value),null);
});

test('discovery event sends merchant ID and source without origin, query or route', async () => {
  const bodies:string[]=[];
  const api=client((async (_url,init)=>{bodies.push(String(init?.body));return Response.json({ok:true});}) as typeof fetch);
  await api.event({eventId:'e1',merchantId:'shop',event:'MAP_SELECT',source:'map'});
  assert.deepEqual(JSON.parse(bodies[0]),{eventId:'e1',merchantId:'shop',event:'MAP_SELECT',source:'map'});
  assert.doesNotMatch(bodies[0],/latitude|longitude|query|geometry/);
});


test('malformed successful search is rejected before UI state consumes it', async()=>{
  const api=client((async()=>Response.json({schemaVersion:1,merchants:[{id:'a'}],clusters:[],nextCursor:null})) as typeof fetch);
  await assert.rejects(api.search({bounds:{west:127,south:37,east:128,north:38},zoom:12}),
    (error:unknown)=>error instanceof DiscoveryApiError&&error.code==='INVALID_RESPONSE');
});
