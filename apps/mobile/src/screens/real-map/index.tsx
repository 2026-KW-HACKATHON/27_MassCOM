import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, RefreshControl, StyleSheet, Text, TextInput, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/ui/app-header';
import { Fold } from '@/ui/fold';
import { isLargeText } from '@/ui/large-text';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { StatusBarScrim, useStatusBarScrim } from '@/ui/status-bar-scrim';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { businessLabel, campaignLabel, enrollmentLabel, photoKindLabel, rewardLabel, routeWarningLabel } from '@/merchant/real-world-labels';

import type { AccountCredential } from '@/auth/account-credential';
import { useAuthSession } from '@/auth/auth-provider';
import { createDiscoveryApiClient, DiscoveryApiError, publishedPhotoUri, type Bounds, type DiscoveryQuery, type MerchantDetail, type MerchantSummary, type Point, type WalkingRoute } from '@/merchant/discovery-api';
import { discoveryState, serializeDiscoveryNavigation } from '@/merchant/discovery-state';
import { merchantCategories } from '@/merchant/merchant-categories';
import { TmapMap } from '@/maps/tmap-view';
import { buildMerchantGoals } from '../collection/collection-stamps';
import { createStudioApiClient, type StudioGoal } from '@/studio/studio-api';
import { resolveStudioGoal } from '@/studio/studio-goals';
import { fetchCollectiblePreview, type CollectiblePreview } from '@/merchant/collectible-preview-api';
import { useDiscoveryProgress } from '../merchant-list/use-discovery-progress';
import { useAppForeground } from '@/merchant-art/use-merchant-art';
import { makeRealMapStyles } from './styles';
import { createRouteRequestGate, routePlanKey } from './route-request';
import { discoveryStorageKeys, loadDiscoveryStorage } from './discovery-storage';
import { getAppPackageId } from '@/config/app-identity';
import { clusterMarkerId, clusterQueryBounds, markersForDiscovery } from './server-clusters';
import type { MapCluster } from '../../../../api/src/real-world-contract';
import { CourseStop, buildWalkingRouteInput, fetchCourseDetails, createCourse, moveStop, recommendStops, replaceStop, restoreCourse, serializeCourse, setDwell } from './course';

// Service area is only an initial camera and search viewport, never a claimed device position.
const initialCamera = { latitude: 37.6206, longitude: 127.0567, zoom: 14 };
const initialBounds: Bounds = { west: 127.025, south: 37.604, east: 127.088, north: 37.642 };

type Props = { apiUrl: string; credential?: AccountCredential; onSessionInvalid: () => Promise<void>; initialMode?: 'map' | 'list' };
export function RealMapScreen({ apiUrl, credential, onSessionInvalid, initialMode }: Props) {
  const router = useRouter();
  const scheme=useColorScheme();
  const palette=colorsForScheme(scheme);
  const world=worldForScheme(scheme);
  const styles=useMemo(()=>StyleSheet.create(makeRealMapStyles(palette,world)),[palette,world]);
  const auth = useAuthSession();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const scrim=useStatusBarScrim();
  const { fontScale } = useWindowDimensions();
  const state = useSyncExternalStore(discoveryState.subscribe, discoveryState.snapshot, discoveryState.snapshot);
  const [camera, setCamera] = useState(initialCamera);
  const [bounds, setBounds] = useState(initialBounds);
  const [focused, setFocused] = useState(false);
  const foreground = useAppForeground();
  const [filterToken, setFilterToken] = useState(0);
  const [clusterIds, setClusterIds] = useState<string[]>([]);
  const [selectedCluster,setSelectedCluster]=useState<MapCluster|null>(null);
  const [clusterPage,setClusterPage]=useState<{clusterId:string;query:DiscoveryQuery;merchants:MerchantSummary[];nextCursor:string|null;loading:boolean;error:string|null}|null>(null);
  const [gpsMessage, setGpsMessage] = useState('내 위치를 사용하지 않습니다');
  const [gpsPrompt,setGpsPrompt]=useState(false);
  const [manualText, setManualText] = useState('');
  const [places, setPlaces] = useState<{id:string;name:string;roadAddress:string;point:Point;expiresAt:string}[]>([]);
  const [originMessage, setOriginMessage] = useState('');
  const [course, setCourse] = useState<CourseStop[]>([]);
  const [courseReady, setCourseReady] = useState(false);
  const [route, setRoute] = useState<WalkingRoute | null>(null);
  const [routeMessage, setRouteMessage] = useState('');
  const request = useRef<AbortController | null>(null);
  const clusterRequest=useRef<AbortController|null>(null);
  const clusterGeneration=useRef(0);
  const [routeGate]=useState(createRouteRequestGate);
  const [courseDetails,setCourseDetails]=useState<Record<string,MerchantDetail|null>>({});
  const locationGeneration = useRef(0);
  const searchDelay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedScope = useRef<string | null>(null);
  const storageKeys = useMemo(() => auth.accountId ? discoveryStorageKeys({ accountId: auth.accountId, apiUrl, packageId: getAppPackageId() ?? '' }) : null, [auth.accountId, apiUrl]);
  const storageScope = storageKeys?.navigation ?? null;
  const api = useMemo(() => createDiscoveryApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const progress = useDiscoveryProgress({apiUrl,credential,onSessionInvalid,refreshToken:filterToken});
  const studioApi=useMemo(()=>credential?createStudioApiClient({apiUrl,credential,onSessionInvalid}):null,[apiUrl,credential,onSessionInvalid]);
  const [wantedState,setWantedState]=useState<{accountId:string;goal:StudioGoal;preview:CollectiblePreview|null;merchant:MerchantSummary|null}|null>(null);
  useEffect(()=>{if(!studioApi||!auth.accountId||!focused)return;let alive=true;const accountId=auth.accountId;
    void studioApi.getMine().then(async value=>{const goal=value.studio.goal;
      let preview:CollectiblePreview|null=null;let merchant:MerchantSummary|null=null;
      if(goal?.kind==='collectible'&&goal.merchantId)[preview,merchant]=await Promise.all([fetchCollectiblePreview(apiUrl,goal.merchantId).catch(()=>null),api.merchant(goal.merchantId).catch(()=>null)]);
      if(alive)setWantedState({accountId,goal,preview,merchant});
    }).catch(()=>{if(alive)setWantedState({accountId,goal:null,preview:null,merchant:null});});return()=>{alive=false;};},[studioApi,auth.accountId,focused,apiUrl,api,filterToken]);
  const wanted=auth.accountId===wantedState?.accountId?wantedState:null;
  const visited = useMemo(()=>new Set(progress.collection?.visits.filter(visit=>visit.progressCounted).map(visit=>visit.merchantId) ?? []),[progress.collection]);
  const goalMerchants=useMemo(()=>[...state.merchants,...(wanted?.merchant&&!state.merchants.some(m=>m.id===wanted.merchant?.id)?[wanted.merchant]:[])]
    .filter((m):m is MerchantSummary & {campaign:NonNullable<MerchantSummary['campaign']>}=>m.campaign?.state==='ACTIVE'&&m.campaign.enrollment!=='CLOSED')
    .map(m=>({id:m.id,name:m.name,campaign:{id:m.campaign.id,title:m.campaign.title,startsAt:m.campaign.startsAt,endsAt:m.campaign.endsAt,
      enrollmentStatus:m.campaign.enrollment==='FULL'?'FULL' as const:'OPEN' as const,rewardGoals:m.campaign.goals}})),[state.merchants,wanted]);
  const evaluatedAt=state.merchants[0]?.business.evaluatedAt??wanted?.merchant?.business.evaluatedAt??'1970-01-01T00:00:00Z';
  const wantedResolution=useMemo(()=>wanted&&progress.collection?resolveStudioGoal(wanted.goal,goalMerchants,progress.collection,Date.parse(evaluatedAt),wanted.preview??undefined):undefined,
    [wanted,progress.collection,goalMerchants,evaluatedAt]);
  const wantedMerchantId=wantedResolution?.status==='active'&&wanted?.goal?.kind==='collectible'?wanted.goal.merchantId:null;
  const interested=useMemo(()=>new Set(wantedMerchantId?[wantedMerchantId]:[]),[wantedMerchantId]);
  const visible = useMemo(()=>state.merchants.filter(m=>(!state.filters.unvisitedOnly || (progress.collection && !visited.has(m.id))) && (!state.filters.interestedOnly || interested.has(m.id))),[state.merchants,state.filters,progress.collection,visited,interested]);
  const selected = state.merchants.find(m=>m.id===state.selectedId);
  const remaining=useMemo(()=>{const goals=buildMerchantGoals(goalMerchants,progress.collection?.visits??[],progress.collection?.collectibles??[],evaluatedAt);
    return new Map(goals.map(goal=>[goal.merchantId,goal.remainingVisits]));},[goalMerchants,progress.collection,evaluatedAt]);
  const suggestions = useMemo(()=>recommendStops(visible,visited,interested,remaining),[visible,visited,interested,remaining]);
  const mapMarkers = useMemo(()=>markersForDiscovery(state.clusters,visible,visited),[state.clusters,visible,visited]);
  const clusterLeafVisible=useMemo(()=>clusterPage?.merchants.filter(m=>(!state.filters.unvisitedOnly||(progress.collection&&!visited.has(m.id)))&&(!state.filters.interestedOnly||interested.has(m.id)))??[],
    [clusterPage,state.filters,progress.collection,visited,interested]);

  useEffect(()=>{ let alive=true;hydratedScope.current=null;discoveryState.restore(null);
    locationGeneration.current++;request.current?.abort();clusterRequest.current?.abort();clusterGeneration.current++;routeGate.invalidate();
    void Promise.resolve().then(()=>{
      if(!alive)return [null,null];setCourseReady(false);setCourse([]);
      setManualText('');setPlaces([]);setOriginMessage('');setGpsMessage('내 위치를 사용하지 않습니다');setGpsPrompt(false);
      setRoute(null);setRouteMessage('');setCourseDetails({});setClusterIds([]);setSelectedCluster(null);setClusterPage(null);
      return loadDiscoveryStorage(AsyncStorage,storageKeys);
    }).then(([nav,savedCourse])=>{
      if(!alive)return; discoveryState.restore(nav); if(initialMode)discoveryState.setMode(initialMode);setCourse(restoreCourse(savedCourse));setCourseReady(true);hydratedScope.current=storageScope;
    }).catch(()=>{if(alive){if(initialMode)discoveryState.setMode(initialMode);setCourseReady(true);hydratedScope.current=storageScope;}});return()=>{alive=false;};},[initialMode,storageKeys,storageScope,routeGate]);
  const savedNavigation=serializeDiscoveryNavigation(state);
  useEffect(()=>{let previousOrigin=discoveryState.snapshot().origin;let previousFilters=discoveryState.snapshot().filters;return discoveryState.subscribe(()=>{const latest=discoveryState.snapshot();
    const originChanged=latest.origin!==previousOrigin;const filtersChanged=latest.filters!==previousFilters;
    if(originChanged){previousOrigin=latest.origin;routeGate.invalidate();setRoute(null);}
    if(originChanged||filtersChanged){previousFilters=latest.filters;clusterRequest.current?.abort();clusterGeneration.current++;setSelectedCluster(null);setClusterPage(null);}
  });},[routeGate]);
  useEffect(()=>{if(!focused||!courseReady||!course.length)return;let alive=true;const controller=new AbortController();
    void Promise.all(course.map(async stop=>{try{return [stop.merchantId,await api.merchant(stop.merchantId,controller.signal)] as const;}catch{return [stop.merchantId,null] as const;}}))
      .then(entries=>{if(alive)setCourseDetails(Object.fromEntries(entries));});
    return()=>{alive=false;controller.abort();};},[api,course,courseReady,focused]);
  useEffect(()=>{if(state.mode==='list')scrim.scrollY.set(0);},[state.mode,scrim.scrollY]);
  useEffect(()=>{if(storageKeys&&hydratedScope.current===storageScope)void AsyncStorage.setItem(storageKeys.navigation,savedNavigation).catch(()=>undefined);},[savedNavigation,storageKeys,storageScope]);
  useEffect(()=>{if(storageKeys&&courseReady&&hydratedScope.current===storageScope)void AsyncStorage.setItem(storageKeys.course,serializeCourse(course)).catch(()=>undefined);},[course,courseReady,storageKeys,storageScope]);
  useFocusEffect(useCallback(()=>{if(!foreground){setFocused(false);return;}setFocused(true);return()=>{setFocused(false);setGpsPrompt(false);setRoute(null);setRouteMessage('복귀 시 최신 영업 정보와 경로를 다시 확인하세요.');locationGeneration.current++;request.current?.abort();clusterRequest.current?.abort();clusterGeneration.current++;routeGate.invalidate();if(discoveryState.snapshot().origin?.basis==='CURRENT_LOCATION'){discoveryState.setOrigin(null);setGpsMessage('내 위치를 사용하지 않습니다');}discoveryState.invalidate();};},[routeGate,foreground]));

  const load = useCallback((cursor=false)=>{
    if(hydratedScope.current!==storageScope || !apiUrl)return;
    const token = cursor?discoveryState.beginNext():discoveryState.begin({bounds,zoom:camera.zoom,query:state.filters.query.trim()||undefined,
      category:state.filters.category??undefined,campaignOnly:state.filters.campaignOnly,openOnly:state.filters.openOnly,origin:state.origin??{latitude:camera.latitude,longitude:camera.longitude,basis:'MAP_CENTER'},limit:40});
    if(!token)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    void api.search(token.query,controller.signal).then(page=>discoveryState.resolve(token,page)).catch(error=>{
      if(!controller.signal.aborted)discoveryState.reject(token,error instanceof DiscoveryApiError?error.code:'NETWORK_ERROR');
    });
  },[api,apiUrl,bounds,camera,state.filters,state.origin,storageScope]);
  useEffect(()=>{if(!focused||hydratedScope.current!==storageScope)return;if(searchDelay.current)clearTimeout(searchDelay.current);searchDelay.current=setTimeout(()=>load(),350);
    return()=>{if(searchDelay.current)clearTimeout(searchDelay.current);};},[focused,load,courseReady,storageScope]);
  const refresh=()=>{setFilterToken(value=>value+1);load();};
  function event(merchantId:string, name:'MAP_SELECT'|'DETAIL_VIEW'|'DIRECTIONS_OPEN', source:'map'|'list'|'recommendation') {
    void api.event({eventId:Crypto.randomUUID(),merchantId,event:name,source}).catch(()=>undefined);
  }
  function select(id:string, source:'map'|'list'|'recommendation') {
    discoveryState.select(id);setClusterIds([]);if(source==='map')event(id,'MAP_SELECT',source);
  }
  function openMerchant(id:string,source:'map'|'list'|'recommendation') {
    discoveryState.select(id);router.push({pathname:'/merchants/[merchantId]',params:{merchantId:id,from:source}});
  }
  function viewport(value:{bounds:Bounds;camera:typeof initialCamera}) {
    setBounds(previous=>JSON.stringify(previous)===JSON.stringify(value.bounds)?previous:value.bounds);
    setCamera(previous=>JSON.stringify(previous)===JSON.stringify(value.camera)?previous:value.camera);
  }
  function loadClusterPage(cluster:MapCluster,cursor?:string,baseQuery?:DiscoveryQuery) {
    const generation=++clusterGeneration.current;clusterRequest.current?.abort();const controller=new AbortController();clusterRequest.current=controller;
    const query:DiscoveryQuery=baseQuery??{bounds:clusterQueryBounds(cluster.bounds,cluster.id,state.query?.zoom??camera.zoom,state.query?.bounds??bounds),zoom:Math.min(camera.zoom+2,20),query:state.filters.query.trim()||undefined,
      category:state.filters.category??undefined,campaignOnly:state.filters.campaignOnly,openOnly:state.filters.openOnly,
      origin:state.origin??{latitude:cluster.position.latitude,longitude:cluster.position.longitude,basis:'MAP_CENTER'},limit:50};
    setClusterPage(previous=>cursor&&previous?.clusterId===cluster.id?{...previous,loading:true,error:null}:{clusterId:cluster.id,query,merchants:[],nextCursor:null,loading:true,error:null});
    void api.search({...query,cursor},controller.signal).then(page=>{if(generation!==clusterGeneration.current||controller.signal.aborted)return;
      setClusterPage(previous=>({clusterId:cluster.id,query,merchants:cursor&&previous?.clusterId===cluster.id?
        [...previous.merchants,...page.merchants.filter(m=>!previous.merchants.some(old=>old.id===m.id))]:page.merchants,
        nextCursor:page.nextCursor,loading:false,error:null}));
    }).catch(error=>{if(generation===clusterGeneration.current&&!controller.signal.aborted)setClusterPage(previous=>previous?{...previous,loading:false,error:error instanceof DiscoveryApiError?error.code:'NETWORK_ERROR'}:null);});
  }
  function openServerCluster(cluster:MapCluster) {
    setSelectedCluster(cluster);setClusterIds([]);
    setCamera(previous=>({...previous,latitude:cluster.position.latitude,longitude:cluster.position.longitude,zoom:Math.min(previous.zoom+2,20)}));
    setBounds(clusterQueryBounds(cluster.bounds,cluster.id,state.query?.zoom??camera.zoom,state.query?.bounds??bounds));
    loadClusterPage(cluster);
  }
  function cluster(ids:string[]) {
    const server=state.clusters.find(item=>ids.includes(clusterMarkerId(item.id)));
    if(server){openServerCluster(server);return;}
    setClusterIds(ids);if(ids.length===1)select(ids[0],'map');
  }
  function sameBuilding(id:string) {
    const item=state.merchants.find(m=>m.id===id);if(!item?.position)return [];
    return visible.filter(m=>m.position?.latitude===item.position?.latitude&&m.position?.longitude===item.position?.longitude);
  }
  async function requestGps() {
    const generation=++locationGeneration.current;setGpsMessage('현재 위치 확인 중');
    try {
      if(!(await Location.hasServicesEnabledAsync())){if(generation===locationGeneration.current)setGpsMessage('기기 위치 서비스가 꺼져 있습니다. 설정에서 켜거나 출발지를 직접 고르세요.');return;}
      const permission=await Location.requestForegroundPermissionsAsync();
      if(generation!==locationGeneration.current)return;
      if(permission.status!=='granted'){setGpsMessage('위치 권한이 거부되었습니다. 출발지를 직접 고를 수 있습니다.');return;}
      const fix=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
      if(generation!==locationGeneration.current)return;
      if(!Number.isFinite(fix.timestamp)||Date.now()-fix.timestamp>60000){setGpsMessage('위치 정보가 오래되었습니다. 다시 확인하거나 출발지를 직접 고르세요.');return;}
      if(!Number.isFinite(fix.coords.latitude)||!Number.isFinite(fix.coords.longitude)||fix.coords.accuracy===null||!Number.isFinite(fix.coords.accuracy)||fix.coords.accuracy>100){setGpsMessage('위치 정확도가 낮습니다. 출발지를 직접 고르세요.');return;}
      routeGate.invalidate();discoveryState.setOrigin({latitude:fix.coords.latitude,longitude:fix.coords.longitude,basis:'CURRENT_LOCATION'});
      setGpsMessage(`현재 위치 사용 중 · 정확도 약 ${Math.round(fix.coords.accuracy)}m`);setRoute(null);
    } catch {if(generation===locationGeneration.current)setGpsMessage('위치를 확인하지 못했습니다. 출발지를 직접 고르세요.');}
  }
  async function findManualOrigin() {
    if(!manualText.trim())return;setOriginMessage('주소를 찾는 중');setPlaces([]);
    const generation=locationGeneration.current;
    try {const result=await api.places({query:manualText.trim()});if(generation!==locationGeneration.current)return;setPlaces(result.places.filter(place=>Date.parse(place.expiresAt)>Date.now()));setOriginMessage(result.places.length?'검색 결과에서 출발지를 선택하세요.':'주소를 찾지 못했습니다.');}
    catch(error){if(generation!==locationGeneration.current)return;setOriginMessage(error instanceof DiscoveryApiError&&error.code==='MAP_NOT_CONFIGURED'?'장소 검색 키가 연결되지 않았습니다. 지도에서 출발지를 직접 고르세요.':'주소 검색에 실패했습니다.');}
  }
  function chooseManual(point:Point,label:string,expiresAt?:string) {routeGate.invalidate();discoveryState.setOrigin({...point,basis:'MANUAL'},expiresAt);setOriginMessage(`${label} 출발`);setPlaces([]);setRoute(null);}
  function updateCourse(next:CourseStop[]) {routeGate.invalidate();setCourseDetails({});setCourse(next);setRoute(null);setRouteMessage('순서가 바뀌었습니다. 보행 경로를 다시 확인하세요.');}
  async function calculateRoute() {
    const origin=state.origin;
    if(!origin){setRouteMessage('먼저 출발지를 직접 선택하거나 현재 위치를 허용하세요.');return;}
    if(!course.length){setRouteMessage('코스에 가게를 추가하세요.');return;}
    const planned=[...course];const key=routePlanKey(origin,planned);
    const controller=new AbortController();const token=routeGate.begin(controller,key);
    setRouteMessage('가게 최신 정보와 실제 보행 경로 확인 중');setRoute(null);
    const current=()=>routeGate.isCurrent(token,routePlanKey(discoveryState.snapshot().origin,course));
    try {
      const details=await fetchCourseDetails(planned,api.merchant,controller.signal);
      if(!current())return;
      if(details.some(detail=>!detail.position)){setRouteMessage('위치 확인이 필요한 가게는 코스에서 바꾸세요.');return;}
      setCourseDetails(Object.fromEntries(details.map(detail=>[detail.id,detail])));
      const result=await api.walk(buildWalkingRouteInput(origin,planned,new Date().toISOString()),controller.signal);
      if(current()){setRoute(result);setRouteMessage('실제 보행 경로 · 영업 정보는 출발 전 다시 확인하세요.');}
    } catch(error) {if(current())setRouteMessage(error instanceof DiscoveryApiError&&error.code==='MAP_NOT_CONFIGURED'?'보행 경로 키가 연결되지 않았습니다. 가게 상세의 주소로 외부 지도를 열 수 있습니다.':
      error instanceof DiscoveryApiError&&error.status===404?'코스 가게가 더는 게시되지 않았습니다. 다른 가게로 바꿔 주세요.':'보행 경로를 가져오지 못했습니다. 가게를 바꾸거나 주소로 길찾기를 이용하세요.');}
  }
  const button=(label:string,onPress:()=>void,selected=false)=><Pressable accessibilityRole="button" accessibilityState={{selected}} onPress={onPress} style={[styles.button,selected&&styles.selected]}><Text style={styles.buttonText}>{selected?`✓ ${label}`:label}</Text></Pressable>;
  const row=(merchant:MerchantSummary,source:'list'|'map'|'recommendation')=><Pressable key={merchant.id} accessibilityRole="button" accessibilityLabel={`${merchant.name}, ${merchant.roadAddress}, ${merchant.position?'위치 확인됨':'위치 확인 필요'}, ${businessLabel(merchant.business)}, ${merchant.campaign?`${campaignLabel(merchant.campaign.state)} 캠페인, ${rewardLabel(merchant.campaign.rewardAvailability)}`:'진행 중인 캠페인 없음'}, ${merchant.distance?`${Math.round(merchant.distance.meters)}미터 직선거리`:'거리 정보 없음'}`} accessibilityState={{selected:state.selectedId===merchant.id}} accessibilityHint="상세 보기와 코스 추가 동작이 있습니다" onPress={()=>select(merchant.id,source)} style={styles.row}>
    <View style={styles.photoBox}>{merchant.thumbnail&&publishedPhotoUri(apiUrl,merchant.thumbnail.url)?<Image source={{uri:publishedPhotoUri(apiUrl,merchant.thumbnail.url)!}} style={styles.photo}/>:<Text style={styles.photoPlaceholder}>점주 사진 없음</Text>}</View>
    <View style={{flex:1}}><Text style={styles.name}>{merchant.name}{merchant.demo?' · 시연 데이터':''}</Text><Text style={styles.muted}>{merchant.roadAddress}{merchant.floor?` · ${merchant.floor}`:''}</Text><Text style={styles.muted}>{merchant.position?'위치 확인됨':'위치 확인 필요'} · {businessLabel(merchant.business)}</Text>
      <Text style={styles.muted}>{merchant.distance?`${merchant.distance.meters}m 직선거리 · ${merchant.distance.origin==='CURRENT_LOCATION'?'현재 위치':merchant.distance.origin==='MANUAL'?'선택한 출발지':'지도 중심'}`:'거리를 표시할 출발지 없음'} · {merchant.campaign?`${campaignLabel(merchant.campaign.state)} 캠페인 · ${enrollmentLabel(merchant.campaign.enrollment)} · ${rewardLabel(merchant.campaign.rewardAvailability)}`:'진행 중인 캠페인 없음'}</Text>
      {merchant.thumbnail?<Text style={styles.muted}>점주 제공 실제 사진 · {photoKindLabel(merchant.thumbnail.kind)}</Text>:null}
      <View style={styles.actions}>{button('상세',()=>openMerchant(merchant.id,source))}{merchant.position?button('코스에 추가',()=>updateCourse([...course.filter(stop=>stop.merchantId!==merchant.id),...(!course.some(stop=>stop.merchantId===merchant.id)&&course.length<5?createCourse([merchant.id]):[])])):null}</View>
    </View></Pressable>;
  const searchTools=<>
    <TextInput value={state.filters.query} onChangeText={query=>discoveryState.setFilters({query})} placeholder="가게 이름·주소 검색" placeholderTextColor={world.cardMuted} accessibilityLabel="가게 검색" style={[styles.input,styles.searchInput]} returnKeyType="search"/>
    <ScrollView horizontal keyboardShouldPersistTaps="handled" style={styles.filters} contentContainerStyle={[styles.actions,styles.filterRow]}>
      {button('전체',()=>discoveryState.setFilters({category:null,campaignOnly:false,openOnly:false,unvisitedOnly:false,interestedOnly:false}))}
      {button('영업 중',()=>discoveryState.setFilters({openOnly:!state.filters.openOnly}),state.filters.openOnly)}
      {button('캠페인',()=>discoveryState.setFilters({campaignOnly:!state.filters.campaignOnly}),state.filters.campaignOnly)}
      {progress.collection?button('미방문',()=>discoveryState.setFilters({unvisitedOnly:!state.filters.unvisitedOnly}),state.filters.unvisitedOnly):null}
      {interested.size?button('목표 수집품 가게',()=>discoveryState.setFilters({interestedOnly:!state.filters.interestedOnly}),state.filters.interestedOnly):null}
      {merchantCategories.map(category=><View key={category}>{button(category,()=>discoveryState.setFilters({category:state.filters.category===category?null:category}),state.filters.category===category)}</View>)}
    </ScrollView>
  </>;
  const filterSummary=[state.filters.query.trim()&&`검색: ${state.filters.query.trim()}`,state.filters.category,
    state.filters.openOnly&&'영업 중',state.filters.campaignOnly&&'캠페인',state.filters.unvisitedOnly&&'미방문',state.filters.interestedOnly&&'목표 수집품 가게'].filter(Boolean).join(' · ');
  const controls=<>
    <AppHeader title="탐색" subtitle="가게와 코스 찾기" compact /><View style={styles.header}><View style={styles.actions}>{button('지도',()=>discoveryState.setMode('map'),state.mode==='map')}{button('목록',()=>discoveryState.setMode('list'),state.mode==='list')}<Pressable accessibilityRole="button" onPress={refresh} style={styles.button}><Text style={styles.buttonText}>새로고침</Text></Pressable></View></View>
    {state.mode==='map'?<View style={styles.mapSearch}><Fold title="검색·필터" summary={filterSummary||undefined}>{searchTools}</Fold></View>:searchTools}
  </>;
  const panels=<View style={[styles.content,{paddingBottom:state.mode==='map'?20:clearance}]}>
      {state.mode==='map'&&(state.filters.unvisitedOnly||state.filters.interestedOnly)?<Text style={styles.muted}>지도 숫자는 범위의 전체 가게 수입니다. 개인 방문·목표 필터는 불러온 목록과 가게 선택에 적용됩니다.</Text>:null}
      {originMessage?<Text accessibilityRole="alert" style={styles.notice}>{originMessage}</Text>:null}
      {wantedResolution?.status==='unavailable'?<View style={styles.panel}><Text accessibilityRole="alert" style={styles.notice}>{wantedResolution.label}</Text>{button('공간에서 새 목표 고르기',()=>router.push('/studio'))}</View>:null}
      {wantedResolution?.status==='completed'?<Text style={styles.muted}>{wantedResolution.label}</Text>:null}
      <Fold title="출발지·위치 선택" summary={state.origin?.basis==='MANUAL'?'직접 선택한 출발지 사용 중':gpsMessage}>
      <View style={styles.actions}><Pressable accessibilityRole="button" onPress={()=>setGpsPrompt(true)} style={styles.button}><Text style={styles.buttonText}>현재 위치</Text></Pressable>{button('지도 중심을 출발지로',()=>chooseManual(camera,'선택한 지도 중심'))}</View>
      {gpsPrompt?<View style={styles.panel}><Text accessibilityRole="header" style={styles.heading}>이번 한 번 현재 위치 사용</Text><Text style={styles.muted}>선택 사항입니다. 위치를 한 번 확인해 직선거리와 보행 경로 출발지에 사용합니다. 거리 계산을 위해 서비스 서버에 좌표가 전달되고, 보행 경로를 요청할 때만 TMAP에 출발 좌표가 전달됩니다. 백그라운드 위치나 이동 경로를 수집하지 않고, 친구 공유·로그·기기 저장에 남기지 않습니다. 출발지를 직접 고를 수도 있습니다.</Text><View style={styles.actions}><Pressable accessibilityRole="button" onPress={()=>setGpsPrompt(false)} style={styles.button}><Text style={styles.buttonText}>취소</Text></Pressable><Pressable accessibilityRole="button" onPress={()=>{setGpsPrompt(false);void requestGps();}} style={styles.button}><Text style={styles.buttonText}>이번 한 번 위치 확인</Text></Pressable></View></View>:null}
      <Text style={styles.muted}>{gpsMessage}</Text>
      <View style={styles.actions}><TextInput value={manualText} onChangeText={setManualText} placeholder="출발 주소 직접 검색" placeholderTextColor={world.cardMuted} accessibilityLabel="출발 주소" style={[styles.input,{flex:1,minWidth:160}]} onSubmitEditing={()=>{void findManualOrigin();}}/><Pressable accessibilityRole="button" onPress={()=>{void findManualOrigin();}} style={styles.button}><Text style={styles.buttonText}>찾기</Text></Pressable></View>
      {places.map(place=><View key={place.id}>{button(`${place.name} · ${place.roadAddress}`,()=>chooseManual(place.point,place.name,place.expiresAt))}</View>)}
      </Fold>
      {selectedCluster&&clusterPage?.clusterId===selectedCluster.id?<View style={styles.panel}><Text accessibilityRole="header" style={styles.heading}>지도 범위 전체 {selectedCluster.count}곳 · 불러온 {clusterPage.merchants.length}곳</Text><Text style={styles.muted}>개인 방문·목표 필터는 불러온 목록에 적용됩니다.</Text>{clusterPage.error?<Text accessibilityRole="alert" style={styles.notice}>{clusterPage.error} · 다시 확인해 주세요.</Text>:null}{clusterPage.loading?<ActivityIndicator accessibilityLabel="건물 가게 불러오는 중"/>:null}{clusterLeafVisible.map(m=>row(m,'map'))}{clusterPage.nextCursor?<Pressable accessibilityRole="button" onPress={()=>loadClusterPage(selectedCluster,clusterPage.nextCursor!,clusterPage.query)} style={styles.button}><Text style={styles.buttonText}>이 범위 가게 더 보기</Text></Pressable>:null}<Pressable accessibilityRole="button" onPress={()=>{clusterRequest.current?.abort();clusterGeneration.current++;setSelectedCluster(null);setClusterPage(null);}} style={styles.button}><Text style={styles.buttonText}>범위 닫기</Text></Pressable></View>:null}
      {clusterIds.length>1?<View style={styles.panel}><Text style={styles.heading}>같은 건물 가게 {clusterIds.length}곳</Text>{clusterIds.map(id=>state.merchants.find(m=>m.id===id)).filter((m):m is MerchantSummary=>!!m).map(m=>row(m,'map'))}</View>:null}
      {selected?<View style={styles.panel}><Text style={styles.heading}>선택한 가게</Text>{row(selected,state.mode==='map'?'map':'list')}</View>:null}
      {state.error==='DISCOVERY_ZOOM_REQUIRED'?<View style={styles.panel}><Text accessibilityRole="alert" style={styles.notice}>이 범위에 영업 중인 가게가 너무 많습니다. 지도를 확대하거나 영업 중 필터를 해제하세요.</Text>{state.filters.openOnly?button('영업 중 필터 해제',()=>discoveryState.setFilters({openOnly:false})):null}</View>:state.error?<Text accessibilityRole="alert" style={styles.notice}>가게 정보를 불러오지 못했어요. 연결을 확인하고 새로고침해 주세요.</Text>:null}
      {state.loading?<ActivityIndicator accessibilityLabel="가게 불러오는 중"/>:null}
      <Text accessibilityRole="header" style={styles.heading}>가게 {visible.length}곳{state.unlocatedCount?` · 위치 미확인 ${state.unlocatedCount}곳`:''}</Text>
      {!state.loading&&!visible.length?<Text style={styles.notice}>조건에 맞는 실제 가게가 없습니다. 필터를 조정하거나 지도를 이동해 보세요.</Text>:null}
      {visible.map(m=>row(m,'list'))}
      {state.nextCursor?<Pressable accessibilityRole="button" onPress={()=>load(true)} style={styles.button}><Text style={styles.buttonText}>{state.loading?'불러오는 중':'더 보기'}</Text></Pressable>:null}
      <View style={styles.panel}><Text accessibilityRole="header" style={styles.heading}>짧은 탐험 코스</Text><Text style={styles.muted}>저장한 목표 수집품·방문 진행·영업 상태·거리 순으로 제안합니다. 이동 시간은 실제 보행 경로를 요청할 때만 표시합니다.</Text>
        {!course.length&&suggestions.length?button('추천 가게로 코스 만들기',()=>updateCourse(createCourse(suggestions.map(m=>m.id)))):null}
        {course.map((stop,index)=>{const latest=courseDetails[stop.merchantId];const m=latest===undefined?state.merchants.find(item=>item.id===stop.merchantId):latest;return <View key={`${stop.merchantId}-${index}`} style={styles.courseStop}>
          <Text style={styles.name}>{index+1}. {latest===null?'가게 정보 확인 실패 · 다른 가게 선택':m?.name??'가게 최신 정보 확인 중'} · 머무름 {stop.dwellMinutes}분</Text>
          <View style={styles.actions}>{button('앞으로',()=>updateCourse(moveStop(course,index,index-1)))}{button('뒤로',()=>updateCourse(moveStop(course,index,index+1)))}{button('-5분',()=>updateCourse(setDwell(course,index,stop.dwellMinutes-5)))}{button('+5분',()=>updateCourse(setDwell(course,index,stop.dwellMinutes+5)))}{button('빼기',()=>updateCourse(course.filter((_,i)=>i!==index)))}</View>
          <ScrollView horizontal contentContainerStyle={styles.actions}>{suggestions.filter(option=>!course.some((entry,i)=>i!==index&&entry.merchantId===option.id)).map(option=><View key={option.id}>{button(`${option.name}으로 변경`,()=>updateCourse(replaceStop(course,index,option.id)))}</View>)}</ScrollView>
        </View>;})}
        {course.length?<View style={styles.actions}><Pressable accessibilityRole="button" onPress={()=>{void calculateRoute();}} style={styles.button}><Text style={styles.buttonText}>실제 보행 경로 보기</Text></Pressable>{button('코스 지우기',()=>updateCourse([]))}</View>:null}
        {routeMessage?<Text accessibilityRole="alert" style={styles.notice}>{routeMessage}</Text>:null}
        {route?<View><Text style={styles.name}>보행 약 {Math.round(route.travelMeters)}m · {Math.ceil(route.travelSeconds/60)}분 + 머무름 {Math.round(route.dwellSeconds/60)}분</Text><Text style={styles.muted}>{route.attribution} · {new Date(route.expiresAt).toLocaleString('ko-KR')}까지</Text>
          {route.stops.map(stop=><Text key={stop.merchantId} style={styles.muted}>{state.merchants.find(m=>m.id===stop.merchantId)?.name??stop.merchantId}: {new Date(stop.arrivalAt).toLocaleTimeString('ko-KR')} 도착{stop.warnings.length?` · ${stop.warnings.map(routeWarningLabel).join(', ')}`:''}</Text>)}</View>:null}
      </View>
  </View>;
  return state.mode==='list' ? <View style={[styles.screen,{paddingBottom:insets.bottom}]}>
    <ScrollView keyboardShouldPersistTaps="handled" onScroll={scrim.onScroll} scrollEventThrottle={16}
      refreshControl={<RefreshControl refreshing={state.loading} onRefresh={refresh} progressViewOffset={insets.top} tintColor={palette.primary} colors={[palette.primary]} />}
      contentContainerStyle={{paddingBottom:insets.bottom}}>
      {controls}{panels}
    </ScrollView>
    <StatusBarScrim scrollY={scrim.scrollY} />
  </View> : <View style={[styles.screen,{paddingBottom:clearance}]}>
    {isLargeText(fontScale)?<ScrollView keyboardShouldPersistTaps="handled" onScroll={scrim.onScroll} scrollEventThrottle={16} style={styles.largeMapControls}>{controls}</ScrollView>:controls}
    <View style={[styles.mapCanvas,fontScale>=1.8&&{minHeight:100}]}><TmapMap camera={camera} markers={mapMarkers} selectedId={state.selectedId} route={route?.geometry??null} padding={{top:0,right:0,bottom:0,left:0}} active={focused&&foreground} style={{flex:1}}
      onReady={()=>undefined} onError={()=>setOriginMessage('지도를 열지 못했어요. 목록에서 가게를 찾아볼 수 있어요.')} onViewport={viewport} onSelect={(id:string)=>{const server=state.clusters.find(item=>clusterMarkerId(item.id)===id);if(server){openServerCluster(server);return;}select(id,'map');const matches=sameBuilding(id);if(matches.length>1)setClusterIds(matches.map(m=>m.id));}} onCluster={cluster}/></View>
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.mapPanel}>{panels}</ScrollView>
    <StatusBarScrim scrollY={scrim.scrollY} />
  </View>;

}
