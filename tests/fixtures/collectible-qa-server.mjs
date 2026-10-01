// 로컬 화면 검수 전용 합성 fixture입니다. 인증·보상 획득 검증은 실제 API/DB 시험에서 수행합니다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const root = new URL('../../apps/production-web/', import.meta.url);
// 점주 웹이 읽는 /api/web/merchant/me 모양이다. 캠페인은 여기에 없고 아래 collectible-campaigns 경로로만 받는다.
const merchant = { id: 'qa-collectible-store', name: '로컬 검수 가게', role: 'OWNER' };
const campaign = { id: 'qa-collectible-campaign', title: '로컬 방문 캠페인', status: 'ACTIVE', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2099-12-31T00:00:00.000Z', goals: [1,3,5], publication: null };
const port = Number(process.env.COLLECTIBLE_QA_PORT) || 4173;
const projects = new Map();
const projectDelayMs = Math.min(5000, Math.max(0, Number(process.env.COLLECTIBLE_QA_DELAY_MS) || 0));
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
      // 운영 production-web 프록시(apps/production-web/server.mjs)와 같은 모양: 시연이 아닌 점포의 이름·소개·주소·메뉴·영업시간만, id·campaign은 없다.
      if (path === '/merchants') return json(response,{merchants:[{name:merchant.name,story:'검수용 가상 자료',roadAddress:'',menuItems:[],businessHours:'',demo:false}]});
      if (path === `/api/web/merchant/merchants/${merchant.id}/collectible-campaigns`) return json(response,{campaigns:[structuredClone(campaign)]});
      if (path.endsWith('/recent-visits')) return json(response,{businessDate:'2026-09-30',visits:[]});
      if (path.endsWith('/recent-coupon-redemptions')) return json(response,{coupons:[]});
      const match = path.match(/\/collectible-projects(?:\/([^/]+))?(?:\/(publish|copy|unpublish|delete))?$/);
      if (match) {
        const [,id,action]=match;
        if(projectDelayMs && (id || request.method!=='GET'))await new Promise(resolve=>setTimeout(resolve,projectDelayMs));
        if (!id && request.method==='GET') return json(response,{projects:[...projects.values()].map(({project,...wrapper})=>({...wrapper,name:project.name,schemaVersion:1,distributingCampaignId:wrapper.publicationId&&campaign.publication?.publicationId===wrapper.publicationId?campaign.id:null}))});
        if (!id) { const value=full(body.project);projects.set(value.id,value);return json(response,value,201); }
        const saved=projects.get(id);if(!saved)return json(response,{code:'COLLECTIBLE_PROJECT_NOT_FOUND'},404);
        if(request.method==='GET')return json(response,saved);
        if(saved.version!==body.expectedVersion)return json(response,{code:'COLLECTIBLE_VERSION_CONFLICT'},409);
        if(action==='copy'){const copied=full(structuredClone(saved.project));projects.set(copied.id,copied);return json(response,copied,201);}
        if(action==='unpublish'){if(saved.status!=='PUBLISHED')return json(response,{code:'COLLECTIBLE_NOT_PUBLISHED'},409);const linked=campaign.publication?.publicationId===saved.publicationId;if(linked)campaign.publication=null;return json(response,{projectId:saved.id,publicationId:saved.publicationId,unlinkedCampaignId:linked?campaign.id:null});}
        if(action==='delete'){const linked=saved.status==='PUBLISHED'&&campaign.publication?.publicationId===saved.publicationId;if(linked)campaign.publication=null;projects.delete(saved.id);return json(response,{projectId:saved.id,deleted:true,unlinkedCampaignId:linked?campaign.id:null});}
        if(action==='publish'){if(body.campaignId!==campaign.id)return json(response,{code:'COLLECTIBLE_CAMPAIGN_UNAVAILABLE'},409);saved.status='PUBLISHED';saved.publicationId=randomUUID();saved.version++;published=saved;campaign.publication={publicationId:saved.publicationId,projectId:saved.id};return json(response,{project:saved,publicationId:saved.publicationId,campaignId:body.campaignId});}
        if(saved.status==='PUBLISHED')return json(response,{code:'COLLECTIBLE_PUBLISHED_IMMUTABLE'},409);
        saved.project=body.project;saved.version++;saved.updatedAt=new Date().toISOString();return json(response,saved);
      }
      const snapshot = () => {
        const project=published.project,gradeId=project.rewardGrades['1']??project.grades[0].id;
        return {projectId:published.id,publicationId:published.publicationId,gradeId,gradeName:project.grades.find(g=>g.id===gradeId).name,name:project.name,shape:project.shape,theme:project.theme,...project.derived[gradeId],thickness:project.thickness,angle:project.angle,animation:project.motion.find(m=>m.gradeIds.includes(gradeId))?.type??'still',greeting:project.greeting,audio:project.audio,story:project.story,effects:project.effects.filter(e=>e.gradeIds.includes(gradeId))};
      };
      if(path==='/api/web/collection'){const detail=published?snapshot():undefined;return json(response,{visits:[],collectibles:detail?[{entitlementId:'synthetic-qa-entitlement',merchantId:merchant.id,merchantName:merchant.name,campaignId:campaign.id,campaignTitle:campaign.title,targetVisitCount:1,displayName:'첫 방문 수집품',appCollectibleStatus:'COLLECTED',mintJobId:null,recipient:null,nftStatus:'NOT_REQUESTED',nft:null,artwork:detail}]:[]});}
      if(path==='/api/web/collectibles/synthetic-qa-entitlement'&&published)return json(response,snapshot());
      return json(response,{code:'QA_NOT_FOUND'},404);
    }
    const names=new Map([['/merchant/','merchant.html'],['/app/','index.html']]);
    let file=names.get(path);
    // mascot/<pose>.png처럼 assets 아래 한 단계 더 들어간 경로(server.mjs의 마스코트 스티커·뒷면 도장 자산)도 허용한다.
    if(!file){const match=path.match(/^\/(?:(?:app|merchant)\/)?assets\/([a-z0-9-]+\/)?([a-z0-9-]+\.(?:mjs|css|png))$/);if(match)file=`assets/${match[1]??''}${match[2]}`;}
    if(!file){response.writeHead(404).end();return;}
    const bytes=await readFile(new URL(file,root));
    const mime=file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html; charset=utf-8';
    response.writeHead(200,{'content-type':mime,'cache-control':'no-store'});response.end(bytes);
  } catch (error) { json(response,{code:'QA_ERROR',message:error.message},500); }
}).listen(port,'127.0.0.1',()=>console.log(`Synthetic local UI fixture ready on ${port}. No external accounts/data.`));
