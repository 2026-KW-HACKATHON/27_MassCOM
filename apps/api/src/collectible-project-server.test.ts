import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { request as httpRequest } from 'node:http';
import { CollectibleProjectError, type CollectibleProjectService } from './collectible-project.js';
import { photoProject } from './collectible-project-test-support.js';
import { MerchantAccessError } from './merchant-access.js';
import type { PostgresStaffRegistration } from './postgres/staff-registration.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';
import { WebSessionError } from './web-session.js';
import type { WebAuthHandler } from './web-auth.js';

async function start(t: TestContext) {
  const calls: {kind:string; input:any}[]=[];
  const project = {id:'30000000-0000-4000-8000-000000000001',merchantId:'merchant-a',version:1,status:'DRAFT' as const,
    project:photoProject(),publicationId:null,createdAt:'2026-09-30T03:00:00Z',updatedAt:'2026-09-30T03:00:00Z'};
  const projects: CollectibleProjectService={
    list:async input=>{calls.push({kind:'list',input});return [];},
    listCampaigns:async input=>{calls.push({kind:'campaigns',input});return [{id:'campaign-a',title:'가상 캠페인',status:'ACTIVE' as const,
      startsAt:'2026-09-01T00:00:00.000Z',endsAt:'2026-12-01T00:00:00.000Z',goals:[1,3,5] as (1|3|5)[],publication:null}];},
    create:async input=>{calls.push({kind:'create',input});return project;},
    get:async input=>{calls.push({kind:'get',input});return project;},
    save:async input=>{calls.push({kind:'save',input});if(input.expectedVersion!==1)throw new CollectibleProjectError('COLLECTIBLE_VERSION_CONFLICT');return project;},
    copy:async input=>{calls.push({kind:'copy',input});return project;},
    publish:async input=>{calls.push({kind:'publish',input});return {project,publicationId:'publication-1',campaignId:input.campaignId};},
    unpublish:async input=>{calls.push({kind:'unpublish',input});if(input.expectedVersion!==2)throw new CollectibleProjectError('COLLECTIBLE_NOT_PUBLISHED');return {projectId:input.projectId,publicationId:'publication-1',unlinkedCampaignId:'campaign-a'};},
    remove:async input=>{calls.push({kind:'remove',input});return {projectId:input.projectId,deleted:true as const,unlinkedCampaignId:null};},
    getAcquired:async input=>{calls.push({kind:'acquired',input});throw new CollectibleProjectError('COLLECTIBLE_NOT_FOUND');},
  };
  const webAuth:WebAuthHandler={
    start:async()=>({location:'https://example.com',state:'state'}),complete:async()=>({token:'session'}),logout:async()=>{},
    resolveSession:async token=>{if(token!=='session')throw new WebSessionError('WEB_SESSION_INVALID');return 'owner-a';},
    resolveSessionWithAge:async()=>({accountId:'owner-a',ageMs:0}),
  };
  const access = {requirePermission:async(input:{accountId:string;merchantId:string;permission:string})=>{
    calls.push({kind:'access',input}); if(input.accountId!=='owner-a'||input.merchantId!=='merchant-a')throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    return {merchantId:input.merchantId,role:'OWNER' as const,permissions:[]};
  }};
  const staff={mine:async()=>[{id:'merchant-a',name:'점포 A',role:'OWNER' as const}]} as unknown as PostgresStaffRegistration;
  const wallet = new WalletChallengeService({domain:'masscom.kr',uri:'https://masscom.kr',chainId:84532,ttlMs:300000,store:new InMemoryChallengeStore()});
  const api=createApiServer(wallet,developmentHeaderAccountResolver,undefined,access,undefined,undefined,undefined,undefined,
    undefined,undefined,undefined,undefined,undefined,false,webAuth,false,undefined,undefined,undefined,staff,undefined,
    undefined,undefined,undefined,undefined,undefined,undefined,undefined,projects);
  api.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>api.once('listening',resolve));
  t.after(()=>new Promise<void>((resolve,reject)=>api.close(error=>error?reject(error):resolve())));
  const addr=api.address(); assert.ok(addr&&typeof addr==='object'); const url=`http://127.0.0.1:${addr.port}`;
  const request = (path:string, method='GET', body?:unknown, headers:Record<string,string>={}) => new Promise<{status:number;headers:{get:(name:string)=>string|undefined};json:()=>Promise<any>}>((resolve,reject)=>{
    const payload=body===undefined?undefined:JSON.stringify(body);
    const req=httpRequest(url+path,{method,headers:{host:'masscom.kr',cookie:'web_session=session',origin:'https://masscom.kr',
      'content-type':'application/json',...(payload?{'content-length':String(Buffer.byteLength(payload))}:{}),...headers}},res=>{
      const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>resolve({status:res.statusCode!,
        headers:{get:name=>res.headers[name] as string|undefined},json:async()=>JSON.parse(Buffer.concat(chunks).toString())}));res.on('error',reject);
    });req.on('error',reject);req.end(payload);
  });
  return {request,calls,project};
}
const base='/api/web/merchant/merchants/merchant-a/collectible-projects';

test('web project routes use host-bound session, MANAGE_ART and CSRF before parsing private media, and return no-store', async t=>{
  const {request,calls}=await start(t);
  assert.equal((await request(base,'GET',undefined,{cookie:''})).status,401);
  assert.equal((await request(base,'POST',{project:photoProject()},{origin:'https://attacker.example'})).status,403);
  assert.equal((await request(base,'POST',{project:photoProject()},{'content-type':'text/plain'})).status,403);
  assert.equal((await request(base,'GET',undefined,{host:'attacker.example'})).status,403);
  assert.equal(calls.length,0);
  const created=await request(base,'POST',{project:photoProject()});assert.equal(created.status,201);assert.equal(created.headers.get('cache-control'),'no-store');
  assert.equal(calls[0]!.kind,'access');assert.equal(calls[0]!.input.permission,'MANAGE_ART');assert.equal(calls[1]!.input.accountId,'owner-a');
  assert.equal((await request(base.replace('merchant-a','merchant-b'))).status,403);
});

test('project request contracts reject forged author/campaign fields and require optimistic versions for save/publish/copy',async t=>{
  const {request,project}=await start(t);
  assert.equal((await request(base,'POST',{project:photoProject(),accountId:'forged'})).status,400);
  const path=`${base}/${project.id}`;
  assert.equal((await request(path,'PUT',{project:photoProject()})).status,400);
  assert.equal((await request(path,'PUT',{expectedVersion:2,project:photoProject()})).status,409);
  assert.equal((await request(path,'PUT',{expectedVersion:1,project:photoProject()})).status,200);
  assert.equal((await request(path+'/copy','POST',{expectedVersion:1})).status,201);
  assert.equal((await request(path+'/publish','POST',{expectedVersion:1,campaignId:'campaign-a'})).status,200);
  assert.equal((await request(base+'/%ZZ')).status,400);
  assert.equal((await request(path+'/unpublish','POST',{})).status,400);
  assert.equal((await request(path+'/unpublish','POST',{expectedVersion:2,campaignId:'forged'})).status,400);
  assert.equal((await request(path+'/unpublish','POST',{expectedVersion:1})).status,409);
  const unpublished=await request(path+'/unpublish','POST',{expectedVersion:2});
  assert.equal(unpublished.status,200);assert.deepEqual(await unpublished.json(),{projectId:project.id,publicationId:'publication-1',unlinkedCampaignId:'campaign-a'});
  assert.equal((await request(path+'/delete','GET')).status,404);
  const removed=await request(path+'/delete','POST',{expectedVersion:1});
  assert.equal(removed.status,200);assert.deepEqual(await removed.json(),{projectId:project.id,deleted:true,unlinkedCampaignId:null});
});

test('merchant JSON media body has dedicated bound above ordinary API64KiB and rejects8MiB overflow',async t=>{
  const {request,calls}=await start(t);
  const big=photoProject();big.photo.originalDataUrl='x'.repeat(100_000);
  assert.equal((await request(base,'POST',{project:big})).status,201);
  assert.equal(calls.find(c=>c.kind==='create')!.input.project.photo.originalDataUrl.length,100_000);
  big.photo.originalDataUrl='x'.repeat(8*1024*1024);
  assert.equal((await request(base,'POST',{project:big})).status,413);
  big.photo.originalDataUrl='x'.repeat(8*1024*1024-64*1024);
  assert.equal((await request(base,'POST',{project:big})).status,201);
});

test('customer acquisition route passes only authenticated owner and entitlement, does not accept caller account override',async t=>{
  const {request,calls}=await start(t);
  assert.equal((await request('/api/web/collectibles/30000000-0000-4000-8000-000000000001?accountId=forged')).status,404);
  assert.deepEqual(calls[0],{kind:'acquired',input:{accountId:'owner-a',entitlementId:'30000000-0000-4000-8000-000000000001'}});
  assert.equal((await request('/api/web/collectibles/any','GET',undefined,{cookie:''})).status,401);
  // The unused Bearer twin of the merchant routes (and its large body surface) is gone; only the web session route remains.
  const bearer=await request('/merchant/merchants/merchant-a/collectible-projects','POST',{project:photoProject()},{'x-account-id':'owner-a',cookie:''});
  assert.equal(bearer.status,404);
  const me=await(await request('/api/web/merchant/me')).json() as {accountScope:string;merchants:unknown[]};
  assert.match(me.accountScope,/^[0-9a-f]{64}$/);assert.equal(JSON.stringify(me).includes('owner-a'),false);
});

test('media-bearing writes are limited per store after the permission check; reads and other routes are not',async t=>{
  const {request,calls,project}=await start(t);
  for(let index=0;index<20;index++) assert.equal((await request(base,'POST',{project:photoProject()})).status,201);
  const limited=await request(base,'POST',{project:photoProject()});
  assert.equal(limited.status,429);assert.deepEqual(await limited.json(),{code:'COLLECTIBLE_RATE_LIMITED'});assert.ok(Number(limited.headers.get('retry-after'))>0);
  assert.equal((await request(`${base}/${project.id}`,'PUT',{expectedVersion:1,project:photoProject()})).status,429);
  assert.equal(calls.filter(call=>call.kind==='create').length,20);
  assert.equal((await request(base)).status,200);
  assert.equal((await request(`${base}/${project.id}/unpublish`,'POST',{expectedVersion:2})).status,200);
  // A caller without MANAGE_ART never reaches the limiter, so it cannot use up the store's budget.
  assert.equal((await request(base.replace('merchant-a','merchant-b'),'POST',{project:photoProject()})).status,403);
});

test('campaign list for the editor needs the host-bound session and MANAGE_ART of that store and returns no-store JSON',async t=>{
  const {request,calls}=await start(t);
  const path='/api/web/merchant/merchants/merchant-a/collectible-campaigns';
  assert.equal((await request(path,'GET',undefined,{cookie:''})).status,401);
  assert.equal((await request(path,'GET',undefined,{host:'attacker.example'})).status,403);
  assert.equal((await request(path.replace('merchant-a','merchant-b'))).status,403);
  assert.equal(calls.some(call=>call.kind==='campaigns'),false);
  const ok=await request(path);
  assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');
  assert.deepEqual(await ok.json(),{campaigns:[{id:'campaign-a',title:'가상 캠페인',status:'ACTIVE',startsAt:'2026-09-01T00:00:00.000Z',endsAt:'2026-12-01T00:00:00.000Z',goals:[1,3,5],publication:null}]});
  assert.deepEqual(calls.filter(call=>call.kind!=='access').at(-1),{kind:'campaigns',input:{merchantId:'merchant-a',accountId:'owner-a'}});
  assert.equal((await request(path,'POST',{})).status,404);
});
