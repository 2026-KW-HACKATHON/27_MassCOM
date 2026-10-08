// 로컬 화면 검수 전용 합성 fixture입니다. 인증·보상 획득 검증은 실제 API/DB 시험에서 수행합니다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const root = new URL('../../apps/production-web/', import.meta.url);
// 점주 웹이 읽는 /api/web/merchant/me 모양이다. 캠페인은 여기에 없고 아래 collectible-campaigns 경로로만 받는다.
const fixtureArtUrl = `/merchant-art/${'a'.repeat(64)}.webp`;
// artUrl 전달 경로의 화면 검수는 명시적으로 켠다. 기본 응답은 현재 운영 /me 모양을 유지한다.
const merchant = { id: 'qa-collectible-store', name: '로컬 검수 가게', role: 'OWNER',
  ...(process.env.COLLECTIBLE_QA_STORE_ART === '1' ? { artUrl: fixtureArtUrl } : {}) };
const campaign = { id: 'qa-collectible-campaign', title: '로컬 방문 캠페인', status: 'ACTIVE', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2099-12-31T00:00:00.000Z', goals: [1,3,5], publication: null };
const port = Number(process.env.COLLECTIBLE_QA_PORT) || 4173;
const projects = new Map();
const projectDelayMs = Math.min(5000, Math.max(0, Number(process.env.COLLECTIBLE_QA_DELAY_MS) || 0));
// 실제 생성·과금·인증을 흉내 내지 않는다. 명시적으로 켠 경우 화면 흐름에만 합성 그림을 제공한다.
const syntheticAi = process.env.COLLECTIBLE_QA_AI === '1';
let aiRound = null;
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
      const artBase = `/api/web/merchant/merchants/${merchant.id}/art`;
      if (path === artBase && request.method === 'GET') return json(response, { configured: syntheticAi, current: null, quota: { draftRoundsLeft: 1, finalsLeft: 1 }, round: aiRound });
      if (path === `${artBase}/rounds` && request.method === 'POST') {
        if (!syntheticAi) return json(response, { code: 'AI_ART_NOT_CONFIGURED' }, 503);
        const bytes = await readFile(new URL('assets/mascot-stamp.png', root));
        aiRound = { id: 'synthetic-ui-round', status: 'DRAFTS_READY', chosenIndex: null, final: null, failureCode: null, createdAt: new Date().toISOString(),
          drafts: [{ index: 0, style: 'watercolor', label: '합성 QA 초안 · 실제 AI 생성 아님', imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}` }] };
        return json(response, aiRound, 201);
      }
      if (path === `${artBase}/rounds/synthetic-ui-round` && aiRound) return json(response, aiRound);
      if (path === '/api/web/admin/me') return json(response, { role: 'ADMIN' });
      if (path === '/api/web/admin/merchants') return json(response, { merchants: [] });
      if (path === '/api/web/admin/account-deletion-intakes') return json(response, { intakes: [] });
      if (path === '/api/web/admin/account-deletions/reconcile') return json(response, {});
      if (path === '/api/web/admin/operations-status') return json(response, { merchants: [] });
      if (path === '/api/web/admin/reward-offers') return json(response, { offers: [] });
      if (path === '/api/web/admin/campaign-drafts') return json(response, { campaigns: [] });
      if (path === '/api/web/admin/campaigns') return json(response, { campaigns: [] });
      if (path === '/api/web/admin/funnel') {
        const days = Number(new URL(request.url, 'http://localhost').searchParams.get('days') || 30);
        const from = new Date(Date.UTC(2026, 9, 3) - (days - 1) * 86400000).toISOString().slice(0, 10);
        return json(response, { from, to: '2026-10-03', days,
          totals: { detailViews: 21, countedVisits: 8, newVisitors: 3, newVisitorsWithSecondStore: 1, repeatVisitors: 2 },
          merchants: [{ merchantId: merchant.id, name: merchant.name, detailViews: 21, countedVisits: 8,
            uniqueVisitors: 4, repeatVisitors: 2, couponsIssued: 3, couponsRedeemed: 1, collectiblesAcquired: 6 }] });
      }
      // 운영 production-web 프록시(apps/production-web/server.mjs)와 같은 모양: 시연이 아닌 점포의 이름·소개·주소·메뉴·영업시간만, id·campaign은 없다.
      if (path === '/merchants') return json(response,{merchants:[{name:merchant.name,story:'검수용 가상 자료',roadAddress:'',menuItems:[],businessHours:'',demo:false}]});
      if (path === `/api/web/merchant/merchants/${merchant.id}/collectible-campaigns`) return json(response,{campaigns:[structuredClone(campaign)]});
      // 점주 웹 가게 현황(#330) 화면 검수용 합성 응답. 실제 집계·권한은 API 시험이 확인한다.
      if (path === `/api/web/merchant/merchants/${merchant.id}/overview`) {
        const steps = [['basic','가게 기본 정보','DONE',''],['menu','메뉴','DONE','메뉴 2개가 등록돼 있어요.'],['members','점주·직원','DONE','점주 1명 · 직원 2명'],
          ['reward','방문 보상','NEEDS_SETUP','방문 보상 수집품이 아직 캠페인에 연결되지 않았어요. 점주 계정으로 "가게 수집품 만들기"에서 수집품을 만들어 게시해 주세요. 쿠폰 혜택은 운영팀이 플랫폼 단위로 설정해요.'],
          ['campaign','캠페인','SCHEDULED','캠페인 시작일이 아직 되지 않아 고객 목록에는 표시되지 않습니다.'],['visible','고객 앱 공개','WAITING_APPROVAL','운영팀 공개 처리 대기 중이에요.']]
          .map(([key,label,state,hint]) => ({key,label,state,hint}));
        const counts = [0,0,0,2,1,1,2];
        return json(response,{generatedAt:new Date().toISOString(),businessDate:'2026-10-07',weekStartsOn:'2026-10-05',
          visits:{today:2,thisWeek:4,lastWeek:4,total:9,last7Days:['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07'].map((date,index)=>({date,count:counts[index]}))},
          comparison:{lastWeekSameSpan:2,delta:2},couponsRedeemedThisWeek:2,repeatVisitors:3,
          weekVisitors:{first:3,repeat:1},weekCollectibles:[{gradeId:'bronze',gradeName:'브론즈',count:3},{gradeId:'silver',gradeName:'실버',count:1},{gradeId:'gold',gradeName:'골드',count:0}],
          weekCoupons:{issued:3,redeemed:2},weekDetailViews:21,
          campaign:{title:campaign.title,status:'ACTIVE',isPublic:true,phase:'LIVE',startsAt:campaign.startsAt,endsAt:campaign.endsAt},
          readiness:{steps,remaining:3,message:'고객 앱 공개까지 3단계 남았습니다.'}});
      }
      if (path.endsWith('/recent-visits')) return json(response,{businessDate:'2026-09-30',visits:[]});
      if (path.endsWith('/recent-coupon-redemptions')) return json(response,{coupons:[]});
      if (path.endsWith('/visitor-feedback')) return json(response,{tags:[],suggestions:[],notes:[]});
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
    // 가게 그림도 검수용 마스코트 바이트만 제공한다. 운영 데이터나 외부 이미지에는 접근하지 않는다.
    if (path === fixtureArtUrl) {
      response.writeHead(200, {'content-type': 'image/png', 'cache-control': 'no-store'});
      response.end(await readFile(new URL('assets/mascot-stamp.png', root))); return;
    }
    const names=new Map([['/merchant/','merchant.html'],['/app/','index.html'],['/admin/','admin.html']]);
    let file=names.get(path);
    // mascot/<pose>.png처럼 assets 아래 한 단계 더 들어간 경로(server.mjs의 마스코트 스티커·뒷면 도장 자산)도 허용한다.
    if(!file){const match=path.match(/^\/(?:(?:app|merchant|admin)\/)?assets\/([a-z0-9-]+\/)?([a-z0-9-]+\.(?:mjs|css|png))$/);if(match)file=`assets/${match[1]??''}${match[2]}`;}
    if(!file){response.writeHead(404).end();return;}
    const bytes=await readFile(new URL(file,root));
    const mime=file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html; charset=utf-8';
    response.writeHead(200,{'content-type':mime,'cache-control':'no-store'});response.end(bytes);
  } catch (error) { json(response,{code:'QA_ERROR',message:error.message},500); }
}).listen(port,'127.0.0.1',()=>console.log(`Synthetic local UI fixture ready on ${port}. No external accounts/data.`));
