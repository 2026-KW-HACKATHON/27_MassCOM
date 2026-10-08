import * as Crypto from 'expo-crypto';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, RefreshControl, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { useAuthSession } from '@/auth/auth-provider';
import { BadgeApiError, createBadgeApiClient, type CampaignBenefit } from '@/gamification/badge-api';
import { couponStatusLabel } from '@/gamification/badge-rules';
import { createCourseApiClient } from '@/courses/course-api';
import { merchantCourseChip } from '@/courses/course-copy';
import { recommendMerchant } from '@/friends/recommend-share';
import { fetchCollectiblePreview, type CollectiblePreview, type CollectiblePreviewGoal } from '@/merchant/collectible-preview-api';
import { sendDiscoveryDetailView } from '@/merchant/discovery-detail-view';
import { detailViewSource } from '@/merchant/detail-view-api';
import { businessLabel, campaignLabel, enrollmentLabel, openingPeriodLabel, photoKindLabel, rewardLabel } from '@/merchant/real-world-labels';
import { merchantCardFacts, missingFactsNotice } from '@/merchant/merchant-card-facts';
import { campaignPurposeBlock } from '@/merchant/campaign-purpose';
import { coinAvailability, conditionSourceLabel, visitConditions } from '@/merchant/visit-conditions';
import { discoveryState } from '@/merchant/discovery-state';
import { useAppForeground } from '@/merchant-art/use-merchant-art';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { createStudioApiClient } from '@/studio/studio-api';
import { createDiscoveryApiClient, DiscoveryApiError, publishedPhotoUri, type MerchantDetail } from '@/merchant/discovery-api';
import { createVisitorFeedbackApiClient, VisitorFeedbackApiError, type VisitorFeedbackSelection } from '@/merchant/visitor-feedback-api';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';
import { directionsChooserButtons, directionsTargets, openDirections, type DirectionsProvider } from '../town-map/directions';
import { coordinateWalkTargets } from './coordinate-directions';
import { saveCollectibleGoal } from './save-collectible-goal';
import { VisitorFeedbackForm } from './visitor-feedback-form';

export function MerchantDetailScreen({ merchantId, apiUrl, from }: {merchantId:string;apiUrl:string;from?:string}) {
  const auth=useAuthSession();
  return <MerchantDetailContent key={`${apiUrl}:${auth.accountId??'guest'}:${merchantId}`} merchantId={merchantId} apiUrl={apiUrl} from={from} credential={auth.credential} accountId={auth.accountId??null} onSessionInvalid={auth.invalidateSession}/>;
}
function MerchantDetailContent({merchantId,apiUrl,from,credential,accountId,onSessionInvalid}: {merchantId:string;apiUrl:string;from?:string;credential?:AccountCredential;accountId:string|null;onSessionInvalid:()=>Promise<void>}) {
  const insets=useSafeAreaInsets();
  const router=useRouter();
  const ds=useRealDetailStyles();
  const api=useMemo(()=>createDiscoveryApiClient({apiUrl,credential,onSessionInvalid}),[apiUrl,credential,onSessionInvalid]);
  const benefitApi=useMemo(()=>credential?createBadgeApiClient({apiUrl,credential,onSessionInvalid}):null,[apiUrl,credential,onSessionInvalid]);
  const studioApi=useMemo(()=>credential?createStudioApiClient({apiUrl,credential,onSessionInvalid}):null,[apiUrl,credential,onSessionInvalid]);
  const [merchant,setMerchant]=useState<MerchantDetail|null>(null);
  const [preview,setPreview]=useState<CollectiblePreview|null>(null);
  const [benefit,setBenefit]=useState<CampaignBenefit|null>(null);
  const [benefitError,setBenefitError]=useState<string|null>(null);
  const [benefitBusy,setBenefitBusy]=useState(false);
  const [courseChip,setCourseChip]=useState<string>();
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const foreground=useAppForeground();
  const [error,setError]=useState<string|null>(null);
  const generation=useRef(0);
  const goalGeneration=useRef(0);
  const [goalBusy,setGoalBusy]=useState(false);
  const [goalMessage,setGoalMessage]=useState<string|null>(null);
  const refresh=useCallback(async (quiet=false)=>{
    const current=++generation.current;
    if(quiet)setRefreshing(true);else setLoading(true);
    try {
      const detail=await api.merchant(merchantId);
      if(current!==generation.current)return;
      setMerchant(detail);setError(null);
      if(benefitApi&&detail.campaign?.state==='ACTIVE') void benefitApi.getCampaignBenefits()
        .then(items=>{if(current===generation.current){setBenefit(items.find(item=>item.campaignId===detail.campaign?.id)??null);setBenefitError(null);}})
        .catch(()=>{if(current===generation.current){setBenefit(null);setBenefitError('혜택 상태를 확인하지 못했어요. 다시 새로고침해 주세요.');}});
      else {setBenefit(null);setBenefitError(null);}
      void sendDiscoveryDetailView(api,merchantId,detailViewSource(from),()=>Crypto.randomUUID()).catch(()=>undefined);
      if(detail.campaign?.state==='ACTIVE')void fetchCollectiblePreview(apiUrl,merchantId).then(value=>{if(current===generation.current)setPreview(value);}).catch(()=>{if(current===generation.current)setPreview(null);});
      else setPreview(null);
    } catch(cause) {if(current===generation.current){if(cause instanceof DiscoveryApiError&&cause.status===404)setMerchant(null);setError(cause instanceof DiscoveryApiError&&cause.status===404?'이 가게는 게시되지 않았거나 찾을 수 없습니다.':'최신 가게 정보를 가져오지 못했습니다.');}}
    finally {if(current===generation.current){setLoading(false);setRefreshing(false);}}
  },[api,benefitApi,apiUrl,merchantId,from]);
  useFocusEffect(useCallback(()=>{if(!foreground)return;void refresh();return()=>{generation.current++;goalGeneration.current++;setGoalBusy(false);setBenefitBusy(false);};},[refresh,foreground]));
  useFocusEffect(useCallback(()=>{
    setCourseChip(undefined);
    if(!foreground||!credential)return;
    const controller=new AbortController();
    void createCourseApiClient({apiUrl,credential,onSessionInvalid}).list(controller.signal)
      .then(courses=>{if(!controller.signal.aborted)setCourseChip(merchantCourseChip(courses,merchantId));})
      .catch(()=>undefined);
    return()=>controller.abort();
  },[apiUrl,credential,foreground,merchantId,onSessionInvalid]));
  if(loading&&!merchant)return <Frame><StateScene kind="loading" title="실제 가게 정보 확인 중"/></Frame>;
  if(error&&!merchant)return <Frame><StateScene kind="error" title="가게 정보를 표시할 수 없습니다" body={error} action={{label:'다시 확인',onPress:()=>{void refresh();}}}/></Frame>;
  if(!merchant)return <Frame><StateScene kind="empty" title="가게 정보 없음"/></Frame>;
  const photos=merchant.photos;
  const leadPhoto=photos.find(photo=>publishedPhotoUri(apiUrl,photo.url));
  const campaign=merchant.campaign;
  const facts=merchantCardFacts(merchant);
  const factOf=(key:'business'|'lastOrder'|'reward'|'minimumSpend')=>facts.critical.find(fact=>fact.key===key);
  const lastOrderGap=factOf('lastOrder');
  const missingNotice=missingFactsNotice(facts.missing);
  const targets=campaign?[...campaign.goals].sort((a,b)=>a.targetVisitCount-b.targetVisitCount):[];
  const leadVisit=targets[0]?.targetVisitCount;
  const coinNow=coinAvailability(campaign);
  const purposeBlock=campaign?campaignPurposeBlock(campaign.purpose):undefined;
  const source=detailViewSource(from);
  const claimBenefit=async()=>{
    if(!benefitApi||!benefit||benefit.state!=='CLAIMABLE'||benefitBusy)return;
    const current=generation.current;
    setBenefitBusy(true);setBenefitError(null);
    try {
      const result=await benefitApi.claimCampaignBenefit(benefit.benefitId);
      if(current===generation.current)setBenefit({...benefit,state:'OWNED',coupon:result.coupon});
      void benefitApi.getCampaignBenefits().then(items=>{if(current===generation.current)setBenefit(items.find(item=>item.benefitId===benefit.benefitId)??null);}).catch(()=>undefined);
    } catch(cause) {
      if(current!==generation.current)return;
      setBenefitError(cause instanceof BadgeApiError&&cause.code==='CAP_REACHED'?'모두 소진':
        cause instanceof BadgeApiError&&cause.code==='BENEFIT_PAUSED'?'혜택 제공이 잠시 멈췄어요.':'혜택을 받지 못했어요. 다시 시도해 주세요.');
      void benefitApi.getCampaignBenefits().then(items=>{if(current===generation.current)setBenefit(items.find(item=>item.benefitId===benefit.benefitId)??null);}).catch(()=>undefined);
    } finally {if(current===generation.current)setBenefitBusy(false);}
  };
  const saveGoal=async(targetVisitCount:1|3|5)=>{
    if(!studioApi||!campaign||campaign.state!=='ACTIVE'||campaign.rewardAvailability!=='AVAILABLE'||!preview?.publicationId||preview.campaignId!==campaign.id||!preview.goals.some(goal=>goal.visitCount===targetVisitCount))return;
    const current=++goalGeneration.current;setGoalBusy(true);setGoalMessage(null);
    try{const saved=await saveCollectibleGoal(studioApi,{merchantId:merchant.id,campaignId:campaign.id,publicationId:preview.publicationId,targetVisitCount},()=>goalGeneration.current===current);
      if(saved){void api.event({eventId:Crypto.randomUUID(),merchantId:merchant.id,event:'GOAL_SAVE',source:detailViewSource(from)}).catch(()=>undefined);setGoalMessage('목표 수집품을 저장했습니다.');router.push('/studio');}}
    catch{if(goalGeneration.current===current)setGoalMessage('목표를 저장하지 못했습니다. 최신 캠페인과 로그인을 확인해 주세요.');}
    finally{if(goalGeneration.current===current)setGoalBusy(false);}
  };
  const openRoute=()=>{
    const destination=merchant.demo?null:merchant.location?.entrance??merchant.position;
    const exact=destination?coordinateWalkTargets({name:merchant.name,destination,origin:discoveryState.snapshot().origin}):null;
    const fallback=directionsTargets({roadAddress:merchant.roadAddress,demo:merchant.demo});
    if(!exact&&!fallback){Alert.alert('길찾기 불가','확인된 위치나 검색할 주소가 없습니다.');return;}
    const go=(provider:DirectionsProvider)=>{
      const targets=exact?{naver:exact.naver,kakao:exact.kakao??exact.naver}:fallback!;
      void openDirections(targets,provider).then(ok=>{if(!ok)Alert.alert('지도를 열지 못했어요');});
      void api.event({eventId:Crypto.randomUUID(),merchantId:merchant.id,event:'DIRECTIONS_OPEN',source}).catch(()=>undefined);
    };
    if(exact){
      Alert.alert('좌표로 도보 길찾기',`${merchant.name} · ${merchant.location?.entrance?'확인된 입구':'확인된 건물 위치'}\n${discoveryState.snapshot().origin?'선택한 출발지를 사용합니다.':'지도 앱이 현재 위치를 출발지로 사용할 수 있습니다.'} 지도 앱이 없으면 정확한 목적지 표시로 열립니다.`,
        [{text:'취소',style:'cancel'},{text:'네이버 지도 도보',onPress:()=>go('naver')},...(exact.kakao?[{text:'카카오맵 도보',onPress:()=>go('kakao')}]:[])]);
    } else Alert.alert('주소로 지도 검색',`${merchant.name}\n${merchant.roadAddress}\n위치가 확인되지 않아 지도 앱에서 목적지를 직접 확인해 주세요.`,directionsChooserButtons(go));
  };
  return <SkyBackdrop><SkyScrollView header={<BackHeader title="가게 상세"/>} contentContainerStyle={{paddingBottom:48+insets.bottom}} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{void refresh(true);}} progressViewOffset={insets.top}/>}>
    <View style={{padding:16,gap:14}}>
      <FloatingCard>{leadPhoto?<View style={{gap:4,marginBottom:12}}><View style={ds.photoFrame}><Image source={{uri:publishedPhotoUri(apiUrl,leadPhoto.url)!}} resizeMode="cover" style={{width:'100%',height:'100%'}}/></View><Text style={ds.muted}>점주 제공 실제 사진 · {photoKindLabel(leadPhoto.kind)}{leadPhoto.caption?` · ${leadPhoto.caption}`:''}</Text></View>:null}<Text accessibilityRole="header" style={ds.heading}>{merchant.name}{merchant.demo?' · 시연 데이터':''}</Text><Text selectable style={ds.body}>{merchant.story}</Text><Text style={ds.muted}>{merchant.category??'업종 정보 없음'}</Text>
        {courseChip?<Text style={ds.courseChip}>{courseChip}</Text>:null}
        <Pressable accessibilityRole="button" onPress={()=>{void recommendMerchant({id:merchant.id,name:merchant.name,demo:merchant.demo});}} style={ds.action}><Text style={ds.actionText}>친구에게 추천</Text></Pressable></FloatingCard>
      {error?<Text accessibilityRole="alert" style={ds.muted}>{error} 화면을 아래로 당겨 다시 확인하세요.</Text>:null}
      {photos.some(photo=>photo.id!==leadPhoto?.id&&publishedPhotoUri(apiUrl,photo.url))?<FloatingCard><Text accessibilityRole="header" style={ds.section}>가게 사진 더 보기</Text><View style={{gap:10}}>{photos.filter(photo=>photo.id!==leadPhoto?.id&&publishedPhotoUri(apiUrl,photo.url)).map(photo=><View key={photo.id} style={{gap:4}}><View style={ds.photoFrame}><Image source={{uri:publishedPhotoUri(apiUrl,photo.url)!}} resizeMode="cover" style={{width:'100%',height:'100%'}}/></View><Text style={ds.muted}>점주 제공 실제 사진 · {photoKindLabel(photo.kind)}{photo.caption?` · ${photo.caption}`:''}</Text></View>)}</View></FloatingCard>:null}
      <FloatingCard><Text accessibilityRole="header" style={ds.section}>{leadVisit===1?'첫 방문 기념 코인':'방문 기념 코인'}</Text>
        {campaign?<><Text style={ds.body}>{campaign.title} · {campaignLabel(campaign.state)}</Text><Text style={ds.muted}>{new Date(campaign.startsAt).toLocaleDateString('ko-KR')} – {new Date(campaign.endsAt).toLocaleDateString('ko-KR')} · {enrollmentLabel(campaign.enrollment)} · {rewardLabel(campaign.rewardAvailability)}</Text>
          {purposeBlock?<View style={{gap:2}}><Text style={ds.body}>{purposeBlock.headline}</Text>{purposeBlock.lines.map(line=><Text key={line} style={ds.muted}>{line}</Text>)}</View>:null}
          {coinNow.kind==='ok'?null:<Text style={ds.warn}>⚠ {coinNow.reason}</Text>}
          {targets.map(goal=>{const lead=goal.targetVisitCount===leadVisit;const art=preview?.campaignId===campaign.id?preview.goals.find(item=>item.visitCount===goal.targetVisitCount):undefined;
            return <View key={goal.targetVisitCount} style={lead?ds.coinLead:ds.coinLater}><CoinArt goal={art} size={lead?132:56}/>
              <View style={{flex:1,minWidth:0,gap:4}}><Text style={lead?ds.leadName:ds.body}>{goal.targetVisitCount}회 방문 · {goal.displayName}</Text>{art?<Text style={ds.muted}>{art.gradeName}</Text>:null}
                {studioApi&&campaign.state==='ACTIVE'&&campaign.rewardAvailability==='AVAILABLE'&&preview?.campaignId===campaign.id&&preview.publicationId&&preview.goals.some(item=>item.visitCount===goal.targetVisitCount)?<Pressable accessibilityRole="button" accessibilityState={{disabled:goalBusy}} disabled={goalBusy} onPress={()=>{void saveGoal(goal.targetVisitCount);}} style={ds.action}><Text style={ds.actionText}>{goalBusy?'저장 중':`${goal.displayName} 목표로 저장`}</Text></Pressable>:null}</View></View>;})}</>:<Text style={ds.muted}>현재 진행 중인 캠페인이 없습니다. 기존 방문·수집 권리는 도감에서 확인할 수 있습니다.</Text>}
        {campaign&&campaign.state!=='ACTIVE'?<Text style={ds.muted}>현재 캠페인이 진행 중이지 않아 새 수집품 목표를 저장할 수 없습니다.</Text>:null}
        {goalMessage?<Text accessibilityRole="alert" style={ds.muted}>{goalMessage}</Text>:null}
        {preview?.goals.length?<Text style={ds.muted}>AI 생성 수집품 그림 · 실제 가게 사진과 다릅니다</Text>:null}
        <Link href="/collection" asChild><Pressable accessibilityRole="button" style={ds.action}><Text style={ds.actionText}>내 방문과 수집품 확인</Text></Pressable></Link>
      </FloatingCard>
      {campaign&&benefit?<FloatingCard><Text accessibilityRole="header" style={ds.section}>{benefit.title}</Text>
        {benefit.detail?<Text style={ds.body}>{benefit.detail}</Text>:null}
        <Text style={ds.muted}>{benefit.state==='CAP_REACHED'?'모두 소진':benefit.state==='CLAIMABLE'?'받을 수 있음':`내 쿠폰 · ${couponStatusLabel(benefit.coupon!.status)}`}</Text>
        {benefit.state==='CLAIMABLE'?<Pressable accessibilityRole="button" accessibilityState={{disabled:benefitBusy}} disabled={benefitBusy} onPress={()=>{void claimBenefit();}} style={ds.action}><Text style={ds.actionText}>{benefitBusy?'확인 중…':'혜택 받기'}</Text></Pressable>:null}
        {benefit.state==='OWNED'?<Link href="/collection" asChild><Pressable accessibilityRole="button" style={ds.action}><Text style={ds.actionText}>내 쿠폰 보기</Text></Pressable></Link>:null}
      </FloatingCard>:null}
      {benefitError?<Text accessibilityRole="alert" style={ds.muted}>{benefitError}</Text>:null}
      <FloatingCard><Text accessibilityRole="header" style={ds.section}>방문 인정 조건</Text><Text style={ds.muted}>코인은 방문이 인정될 때 받아요.</Text>
        {visitConditions(merchant).map((condition,index)=><Text key={condition.key} style={ds.body}>{`${index+1}. ${condition.text} ${conditionSourceLabel(condition.source)}`}</Text>)}
      </FloatingCard>
      <FloatingCard><Text accessibilityRole="header" style={ds.section}>방문 준비</Text><Line label="주소" value={merchant.roadAddress}/>
        {merchant.floor?<Line label="층·호수" value={`${merchant.floor}${merchant.location?.unit?` · ${merchant.location.unit}`:''}`}/>:null}
        {merchant.entranceNote?<Line label="입구" value={merchant.entranceNote}/>:null}
        <Line label="영업" warn={factOf('business')?.tone==='warning'} value={`${businessLabel(merchant.business)}${merchant.business.informationUpdatedAt?` · ${new Date(merchant.business.informationUpdatedAt).toLocaleString('ko-KR')} 확인`:''}`}/>
        {merchant.business.lastOrderAt?<Line label="마지막 주문 시각" warn={lastOrderGap?.tone==='warning'} value={new Date(merchant.business.lastOrderAt).toLocaleString('ko-KR')}/>:lastOrderGap&&!lastOrderGap.known?<Line label={lastOrderGap.label} warn={lastOrderGap.tone==='warning'} value={lastOrderGap.value}/>:null}
        {merchant.business.nextChangeAt?<Line label="다음 변경" value={new Date(merchant.business.nextChangeAt).toLocaleString('ko-KR')}/>:null}
        {merchant.todayOverride?<Line label="임시 영업 안내" warn={merchant.todayOverride.state==='CLOSED'} value={`${merchant.todayOverride.state==='OPEN'?'임시 영업':'임시 휴업'} · ${merchant.todayOverride.note}`}/>:null}
        {merchant.schedule?<View style={{gap:3}}><Text style={ds.section}>요일별 시간 · 한국 시간</Text>{merchant.schedule.weekly.map(day=><Text key={day.weekday} style={ds.body}>{'월화수목금토일'[day.weekday-1]}요일 · {day.periods.length?day.periods.map(openingPeriodLabel).join(', '):'휴무'}</Text>)}{merchant.schedule.exceptions.filter(exception=>Date.parse(exception.date)>=Date.parse(merchant.business.evaluatedAt)-86400000).slice(0,5).map(exception=><Text key={exception.date} style={ds.body}>{exception.date} 예외 · {exception.periods.length?exception.periods.map(openingPeriodLabel).join(', '):'휴무'}{exception.note?` · ${exception.note}`:''}</Text>)}</View>:merchant.legacyBusinessHours?<Text style={ds.muted}>가게가 적어 둔 영업시간: {merchant.legacyBusinessHours}</Text>:null}
        {merchant.contact.phone?<Line label="전화" value={merchant.contact.phone}/>:null}{merchant.contact.website?<Line label="웹사이트" value={merchant.contact.website}/>:null}
        <Line label="최소 이용" value={`${merchant.minimumSpendWon.toLocaleString('ko-KR')}원`}/><Text style={ds.muted}>{merchant.visitInstructions||'방문 전에 가게의 최신 조건을 확인하세요.'}</Text>
        {missingNotice?<View style={ds.missingBox}><Text accessibilityRole="header" style={ds.missingTitle}>정보가 더 필요한 항목</Text><Text style={ds.missingText}>{missingNotice}</Text></View>:null}
        <Pressable accessibilityRole="button" accessibilityState={{disabled:merchant.demo}} disabled={merchant.demo} onPress={()=>{void openRoute();}} style={ds.action}><Text style={ds.actionText}>{merchant.demo?'시연 점포 길찾기 없음':merchant.position?'좌표로 도보 길찾기':'주소로 지도 검색'}</Text></Pressable>
      </FloatingCard>
      <FloatingCard><Text accessibilityRole="header" style={ds.section}>메뉴·가격</Text>{merchant.menuItems.length?merchant.menuItems.map(item=><Line key={item.id} label={item.name} value={item.priceWon===null?(item.priceNote??'가격 문의'):`${item.priceWon.toLocaleString('ko-KR')}원${item.priceNote?` · ${item.priceNote}`:''}`}/>):<Text style={ds.muted}>등록된 메뉴가 없습니다.</Text>}</FloatingCard>
      {credential&&accountId?<FloatingCard><Text accessibilityRole="header" style={ds.section}>방문 후 의견</Text><MyVisitorFeedback key={`${merchant.id}:${accountId}`} merchantId={merchant.id} apiUrl={apiUrl} credential={credential} onSessionInvalid={onSessionInvalid}/></FloatingCard>:null}
      <FloatingCard><Text accessibilityRole="header" style={ds.section}>이용했다면</Text><Text style={ds.body}>점주가 만든 1회 코드로 방문과 보상권을 확인합니다. 실제 지급 여부는 방문 인증 결과로 결정됩니다.</Text>
        <Link href={{pathname:'/claim',params:{merchantId:merchant.id}}} asChild><Pressable accessibilityRole="button" style={ds.action}><Text style={ds.actionText}>방문 코드 받기</Text></Pressable></Link></FloatingCard>
    </View></SkyScrollView></SkyBackdrop>;
}

function Frame({children}:{children:React.ReactNode}) {return <SkyBackdrop><SkyScrollView header={<BackHeader title="가게 상세"/>}><View style={{padding:16}}>{children}</View></SkyScrollView></SkyBackdrop>;}
function Line({label,value,warn=false}:{label:string;value:string;warn?:boolean}) {const ds=useRealDetailStyles();return <View style={[ds.line,warn&&ds.lineWarn]}><Text style={ds.muted}>{label}</Text><Text selectable style={warn?ds.warn:ds.body}>{warn?'⚠ ':''}{value}</Text></View>;}
/** The coin picture is decorative: the grade name beside it says the same thing. */
function CoinArt({goal,size}:{goal:CollectiblePreviewGoal|undefined;size:number}) {const ds=useRealDetailStyles();return goal?.thumbnailDataUrl?<Image source={{uri:goal.thumbnailDataUrl}} accessible={false} style={{width:size,height:size}}/>:<View style={[ds.previewEmpty,{width:size,height:size}]}/>;}
function useRealDetailStyles() {
  const scheme=useColorScheme();
  const palette=colorsForScheme(scheme);
  const world=worldForScheme(scheme);
  return useMemo(()=>({
    heading:{fontSize:24,fontWeight:'800' as const,color:world.cardInk},
    section:{fontSize:18,fontWeight:'800' as const,color:world.cardInk},
    body:{fontSize:15,lineHeight:23,color:world.cardInk},
    muted:{fontSize:13,lineHeight:20,color:world.cardMuted},
    courseChip:{fontSize:13,lineHeight:20,color:palette.onPrimaryContainer,alignSelf:'flex-start' as const,backgroundColor:palette.primaryContainer,borderRadius:10,paddingHorizontal:10,paddingVertical:4},
    action:{minHeight:48,marginTop:8,borderRadius:12,backgroundColor:palette.primaryContainer,justifyContent:'center' as const,paddingHorizontal:14},
    actionText:{fontSize:15,fontWeight:'700' as const,color:palette.onPrimaryContainer},
    photoFrame:{height:170,backgroundColor:world.paper,borderRadius:12,overflow:'hidden' as const},
    photoEmpty:{height:120,backgroundColor:world.paper,borderRadius:12,justifyContent:'center' as const,alignItems:'center' as const},
    previewEmpty:{width:64,height:64,backgroundColor:world.paper},
    line:{paddingVertical:7,borderBottomWidth:1,borderColor:palette.separator},
    lineWarn:{borderLeftWidth:3,borderLeftColor:palette.error,paddingLeft:8},
    warn:{fontSize:15,lineHeight:23,fontWeight:'700' as const,color:palette.error},
    leadName:{fontSize:17,lineHeight:25,fontWeight:'800' as const,color:world.cardInk},
    coinLead:{flexDirection:'row' as const,alignItems:'center' as const,gap:12,paddingVertical:10},
    coinLater:{flexDirection:'row' as const,alignItems:'center' as const,gap:10,paddingVertical:6},
    missingBox:{marginTop:8,padding:12,borderRadius:12,backgroundColor:palette.accentContainer,gap:4},
    missingTitle:{fontSize:15,fontWeight:'800' as const,color:palette.onAccentContainer},
    missingText:{fontSize:14,lineHeight:21,color:palette.onAccentContainer},
  }),[palette,world]);
}

function MyVisitorFeedback({merchantId,apiUrl,credential,onSessionInvalid}:{merchantId:string;apiUrl:string;credential:AccountCredential;onSessionInvalid:()=>Promise<void>}) {
  const ds=useRealDetailStyles();
  const client=useMemo(()=>createVisitorFeedbackApiClient({apiUrl,credential,onSessionInvalid}),[apiUrl,credential,onSessionInvalid]);
  const [selection,setSelection]=useState<VisitorFeedbackSelection|null>(null);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  const requestVersion=useRef(0);
  async function openForm(){if(loading)return;const version=++requestVersion.current;setLoading(true);setMessage(null);
    try {const mine=await client.getMine(merchantId);if(requestVersion.current===version)setSelection(mine);}
    catch(cause){if(requestVersion.current===version)setMessage(cause instanceof VisitorFeedbackApiError&&cause.code==='NOT_ELIGIBLE'?'방문 인증한 가게에서만 고를 수 있어요.':'내 선택을 불러오지 못했어요. 다시 시도해 주세요.');}
    finally{if(requestVersion.current===version)setLoading(false);}}
  return selection?<VisitorFeedbackForm merchantId={merchantId} client={client} initialSelection={selection} editContext onClose={()=>setSelection(null)} onSaved={()=>{setSelection(null);setMessage('고마워요!');}} onNotEligible={()=>{setSelection(null);setMessage('방문 인증한 가게에서만 고를 수 있어요.');}}/>:
    <View><Pressable accessibilityRole="button" onPress={()=>{void openForm();}} style={ds.action}><Text style={ds.actionText}>{loading?'확인 중':'내 선택 남기기/바꾸기'}</Text></Pressable>{message?<Text accessibilityRole="alert" style={ds.muted}>{message}</Text>:null}</View>;
}
