// 로컬 화면 검수 전용 합성 fixture입니다. 인증·보상 획득 검증은 실제 API/DB 시험에서 수행합니다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const root = new URL('../../apps/production-web/', import.meta.url);
const merchant = { id: 'qa-collectible-store', name: '로컬 검수 가게', role: 'OWNER', campaign: { id: 'qa-collectible-campaign', title: '로컬 방문 캠페인', rewardGoals: [1,3,5].map(targetVisitCount => ({targetVisitCount,displayName:`${targetVisitCount}회 방문`})) } };
const projects = new Map();
let published;
const json = (response, body, status = 200) => { response.writeHead(status, {'content-type':'application/json','cache-control':'no-store'}); response.end(JSON.stringify(body)); };
const full = project => ({ id: randomUUID(),merchantId:merchant.id,version:1,status:'DRAFT',publicationId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),project });
createServer(async (request,response) => {
  try {
    const path = request.url.split('?')[0];
    if (path.startsWith('/api/') || path === '/merchants') {
      let body;
      if (request.method !== 'GET') { const chunks=[]; for await (const chunk of request) chunks.push(chunk); body=JSON.parse(Buffer.concat(chunks).toString()||'{}'); }
      if (path === '/api/web/merchant/me') return json(response,{accountScope:'synthetic-local-qa-owner',merchants:[merchant]});
      if (path === '/api/web/merchant/registration-merchants') return json(response,{merchants:[merchant]});
      if (path === '/merchants') return json(response,{merchants:[{...merchant,artUrl:null,demo:true,story:'검수용 가상 자료',menuItems:[],roadAddress:'',minimumSpendWon:0,businessHours:''}]});
      if (path.endsWith('/recent-visits')) return json(response,{businessDate:'2026-09-30',visits:[]});
      if (path.endsWith('/recent-coupon-redemptions')) return json(response,{redemptions:[]});
      const match = path.match(/\/collectible-projects(?:\/([^/]+))?(?:\/(publish|copy))?$/);
      if (match) {
        const [,id,action]=match;
        if (!id && request.method==='GET') return json(response,{projects:[...projects.values()].map(({project,...wrapper})=>({...wrapper,name:project.name,schemaVersion:1}))});
        if (!id) { const value=full(body.project);projects.set(value.id,value);return json(response,value,201); }
        const saved=projects.get(id);if(!saved)return json(response,{code:'COLLECTIBLE_PROJECT_NOT_FOUND'},404);
        if(request.method==='GET')return json(response,saved);
        if(saved.version!==body.expectedVersion)return json(response,{code:'COLLECTIBLE_VERSION_CONFLICT'},409);
        if(action==='copy'){const copied=full(structuredClone(saved.project));projects.set(copied.id,copied);return json(response,copied,201);}
        if(action==='publish'){saved.status='PUBLISHED';saved.publicationId=randomUUID();saved.version++;published=saved;return json(response,{project:saved,publicationId:saved.publicationId,campaignId:body.campaignId});}
        if(saved.status==='PUBLISHED')return json(response,{code:'COLLECTIBLE_PUBLISHED_IMMUTABLE'},409);
        saved.project=body.project;saved.version++;saved.updatedAt=new Date().toISOString();return json(response,saved);
      }
      const snapshot = () => {
        const project=published.project,gradeId=project.rewardGrades['1']??project.grades[0].id;
        return {projectId:published.id,publicationId:published.publicationId,gradeId,gradeName:project.grades.find(g=>g.id===gradeId).name,name:project.name,shape:project.shape,theme:project.theme,...project.derived[gradeId],thickness:project.thickness,angle:project.angle,animation:project.motion.find(m=>m.gradeIds.includes(gradeId))?.type??'still',greeting:project.greeting,audio:project.audio,story:project.story,effects:project.effects.filter(e=>e.gradeIds.includes(gradeId))};
      };
      if(path==='/api/web/collection'){const detail=published?snapshot():undefined;return json(response,{visits:[],collectibles:detail?[{entitlementId:'synthetic-qa-entitlement',merchantId:merchant.id,merchantName:merchant.name,campaignId:merchant.campaign.id,campaignTitle:merchant.campaign.title,targetVisitCount:1,displayName:'첫 방문 수집품',appCollectibleStatus:'COLLECTED',mintJobId:null,recipient:null,nftStatus:'NOT_REQUESTED',nft:null,artwork:detail}]:[]});}
      if(path==='/api/web/collectibles/synthetic-qa-entitlement'&&published)return json(response,snapshot());
      return json(response,{code:'QA_NOT_FOUND'},404);
    }
    const names=new Map([['/merchant/','merchant.html'],['/app/','index.html']]);
    let file=names.get(path);
    if(!file){const match=path.match(/^\/(?:app|merchant)\/assets\/([a-z-]+\.(?:mjs|css|png))$/);if(match)file=`assets/${match[1]}`;}
    if(!file){response.writeHead(404).end();return;}
    const bytes=await readFile(new URL(file,root));
    const mime=file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html; charset=utf-8';
    response.writeHead(200,{'content-type':mime,'cache-control':'no-store'});response.end(bytes);
  } catch (error) { json(response,{code:'QA_ERROR',message:error.message},500); }
}).listen(4173,'127.0.0.1',()=>console.log('Synthetic local UI fixture ready on 4173. No external accounts/data.'));
