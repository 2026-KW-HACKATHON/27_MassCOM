import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';
import type { ExperienceProfile } from '@/experience/experience-api';
import { ExperienceWardrobe } from '@/experience/experience-wardrobe';
import { useExperience } from '@/experience/use-experience';
import { getAppPackageId } from '@/config/app-identity';
import { consentRecheckLabel, needsConsentRecheck } from '@/privacy/consent-flow';
import { useConsentRecheck } from '@/privacy/consent-recheck';
import { createMerchantApiClient, type PublicMerchant } from '@/merchant/merchant-api';
import { fetchCollectiblePreview, type CollectiblePreview } from '@/merchant/collectible-preview-api';
import { createShopApiClient, type ShopSnapshot } from '@/shop/shop-api';
import { createCoinApiClient, type CoinCollection } from '@/shop/coin-api';
import { friendArt } from '@/shop/shop-art';
import { AvatarWardrobe, clothingArtForId, equippedClothingArt, useEquippedClothingArt } from '@/shop/wardrobe';
import { StudioScene } from '@/studio/studio-scene';
import { ShareFormatButtons, useStudioShare } from '@/studio/studio-share';
import { createStudioApiClient, studioErrorMessage, type FurnitureSnapshot, type Studio, type StudioGoal, type StudioItem, type StudioSnapshot, type StudioTheme, type StudioCoinSource } from '@/studio/studio-api';
import { clampPosition, changeFurniture, ownedFurniture, placeFurniture, removeFurniture, studioAfterSave, studioDirty, studioNeedsReload } from '@/studio/studio-furniture';
import { resolveStudioGoal, studioGoalOptions } from '@/studio/studio-goals';
import { ownedPage, ownedPageSize } from '@/studio/owned-page';
import { runStudioSave } from '@/studio/studio-save';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Fold } from '@/ui/fold';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

const themeLabels: Record<StudioTheme, string> = { daylight: '낮', evening: '저녁', garden: '정원' };
const accentColors = { mint: '#68BAAC', rose: '#E78F9B', sky: '#72A7E6' } as const;
type StudioMode = 'room' | 'coins' | 'companion' | 'goal';
const studioModes: { id: StudioMode; label: string }[] = [
  { id: 'room', label: '가구·벽·바닥' }, { id: 'coins', label: '코인 전시' },
  { id: 'companion', label: '동행·의상' }, { id: 'goal', label: '목표·공유' },
];

function itemFromCollection(item: CollectionSnapshot['collectibles'][number]): StudioItem {
  return {
    entitlementId: item.entitlementId, merchantId: item.merchantId, merchantName: item.merchantName,
    campaignTitle: item.campaignTitle, displayName: item.displayName, artwork: item.artwork,
  };
}

export function StudioScreen({ apiUrl, credential, onSessionInvalid, requestedEntitlement, requestedAvatar, requestedSource }: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>;
  requestedEntitlement?: string; requestedAvatar?: string; requestedSource?: StudioCoinSource;
}) {
  const router = useRouter();
  const navigation = useNavigation();
  const recheckConsent = useConsentRecheck();
  const insets = useSafeAreaInsets();
  const appId = getAppPackageId();
  const palette = colorsForScheme(useColorScheme());
  const { width } = useWindowDimensions();
  const sceneWidth = Math.min(Math.max(width - 28, 280), 460);
  const client = useMemo(() => createStudioApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const collectionClient = useMemo(() => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const shopClient = useMemo(() => createShopApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const coinClient = useMemo(() => createCoinApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const experience = useExperience(apiUrl, credential, onSessionInvalid);
  const merchantClient = useMemo(() => createMerchantApiClient(apiUrl), [apiUrl]);
  const [snapshot, setSnapshot] = useState<StudioSnapshot>();
  const [collection, setCollection] = useState<CollectionSnapshot>();
  const [shop, setShop] = useState<ShopSnapshot>();
  const [merchants, setMerchants] = useState<readonly PublicMerchant[]>([]);
  const [merchantError, setMerchantError] = useState(false);
  const [draft, setDraft] = useState<Studio>();
  const [furniture, setFurniture] = useState<FurnitureSnapshot>();
  const [furnitureError, setFurnitureError] = useState(false);
  const [coinCollection, setCoinCollection] = useState<CoinCollection>();
  const [coinCollectionError, setCoinCollectionError] = useState(false);
  const [coinPage, setCoinPage] = useState(0);
  const requestedSourceKind = requestedSource?.sourceKind;
  const requestedSourceId = requestedSource?.sourceId;
  const requestKey = [requestedEntitlement, requestedAvatar, requestedSourceKind, requestedSourceId].join(':');
  const [modeChoice, setModeChoice] = useState<{ requestKey: string; mode: StudioMode }>();
  const mode: StudioMode = modeChoice?.requestKey === requestKey ? modeChoice.mode
    : requestedEntitlement || requestedSourceId ? 'coins' : requestedAvatar ? 'companion' : 'room';
  const [editingFurniture, setEditingFurniture] = useState(false);
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string>();
  const [goalNow, setGoalNow] = useState(() => Date.now());
  const [wantedPreview, setWantedPreview] = useState<{ merchantId: string; goalPublicationId: string; preview: CollectiblePreview | null; error?: true }>();
  const [avatarChoice, setAvatarChoice] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [clothingChoice, setClothingChoice] = useState<string | null>(null);
  const [clothingSaving, setClothingSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [errorNeedsConsent, setErrorNeedsConsent] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [shareStatus, setShareStatus] = useState<string>();
  const [shareTone, setShareTone] = useState<'success' | 'neutral' | 'error'>('neutral');
  const [preview, setPreview] = useState<{ profile: ExperienceProfile; source: ExperienceProfile; avatar: string | null; client: typeof client } | null>(null);
  const previewProfile = preview?.client === client && preview.source === experience.snapshot?.profile && preview.avatar === avatarChoice ? preview.profile : null;
  const [collectionPage, setCollectionPage] = useState(0);
  const mounted = useRef(false);
  const active = useRef(false);
  const generation = useRef(0);
  const loadedFor = useRef<{ client: typeof client; requestKey: string } | null>(null);
  const currentClient = useRef(client);
  const [allowRemoval, setAllowRemoval] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const pendingRemoval = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const share = useStudioShare(apiUrl, useCallback(() => active.current, []),
    appId === 'kr.masscom.wolgye.demo' || appId === 'kr.masscom.wolgye.dev' || credential.kind === 'demo',
    useCallback((event) => { if (active.current) void client.trackShare(event).catch(() => {}); }, [client]),
    useCallback(() => generation.current, []));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { currentClient.current = client; }, [client]);

  const load = useCallback(async (refresh = false) => {
    const request = ++generation.current;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(undefined);
    setErrorNeedsConsent(false);
    try {
      const [studio, owned, shopSnapshot, catalog, furnitureResult, coins] = await Promise.all([
        client.getMine(), collectionClient.getCollection(), shopClient.getShop(),
        merchantClient.listMerchants().then((items) => ({ items, failed: false as const }))
          .catch(() => ({ items: [] as readonly PublicMerchant[], failed: true as const })),
        client.getFurniture().then((items) => ({ items, failed: false as const }))
          .catch(() => ({ items: undefined, failed: true as const })),
        coinClient.getCollection().then((items) => ({ items, failed: false as const }))
          .catch(() => ({ items: undefined, failed: true as const })),
      ]);
      if (!active.current || request !== generation.current) return;
      loadedFor.current = { client, requestKey };
      setGoalNow(Date.now()); setPreview(null); setSnapshot(studio); setCollection(owned); setShop(shopSnapshot); setMerchants(catalog.items);
      setFurniture(furnitureResult.items); setFurnitureError(furnitureResult.failed); setSelectedFurnitureId(undefined); setEditingFurniture(false);
      setCoinCollection(coins.items); setCoinCollectionError(coins.failed); setCoinPage(0);
      setMerchantError(catalog.failed);
      const requestedIndex = owned.collectibles.findIndex((item) => item.entitlementId === requestedEntitlement);
      setCollectionPage(Math.floor(Math.max(0, requestedIndex) / ownedPageSize));
      const canPlace = requestedEntitlement && owned.collectibles.some((item) => item.entitlementId === requestedEntitlement);
      const needsPlace = canPlace && !studio.studio.slots.includes(requestedEntitlement);
      const baseDraft = needsPlace && studio.studio.slots.length + (studio.studio.coinSlots?.length ?? 0) < 6
        ? { ...studio.studio, slots: [...studio.studio.slots, requestedEntitlement] } : studio.studio;
      const canPlaceCoin = requestedSourceKind && requestedSourceKind !== 'VISIT' && requestedSourceId
        && coins.items?.reroll.sources.some((source) => source.sourceKind === requestedSourceKind && source.sourceId === requestedSourceId)
        && !baseDraft.coinSlots?.some((source) => source.sourceKind === requestedSourceKind && source.sourceId === requestedSourceId);
      setDraft(canPlaceCoin && baseDraft.slots.length + (baseDraft.coinSlots?.length ?? 0) < 6
        ? { ...baseDraft, coinSlots: [...(baseDraft.coinSlots ?? []), { sourceKind: requestedSourceKind, sourceId: requestedSourceId }] } : baseDraft);
      setAvatarChoice(requestedAvatar && shopSnapshot.items.some((item) => item.id === requestedAvatar && item.owned)
        ? requestedAvatar : studio.avatar);
      setClothingChoice(shopSnapshot.clothing.items.some((item) => item.id === shopSnapshot.clothing.equipped && item.owned)
        ? shopSnapshot.clothing.equipped : null);
      setNotice((needsPlace || canPlaceCoin) && studio.studio.slots.length + (studio.studio.coinSlots?.length ?? 0) >= 6
        ? '전시가 가득 찼어요. 다른 수집품을 빼고 골라 주세요.' : undefined);
    } catch (caught) {
      if (active.current && request === generation.current) { setError(studioErrorMessage(caught)); setErrorNeedsConsent(needsConsentRecheck(caught)); }
    } finally {
      if (active.current && request === generation.current) { setLoading(false); setRefreshing(false); }
    }
  }, [client, collectionClient, shopClient, merchantClient, coinClient, requestedEntitlement, requestedAvatar,
    requestedSourceKind, requestedSourceId, requestKey]);

  async function retryMerchants() {
    const request = generation.current;
    try {
      const catalog = await merchantClient.listMerchants();
      if (!active.current || request !== generation.current) return;
      setMerchants(catalog); setMerchantError(false);
    } catch { if (active.current && request === generation.current) setMerchantError(true); }
  }

  useFocusEffect(useCallback(() => {
    active.current = true;
    if (studioNeedsReload(loadedFor.current, client, requestKey)) {
      if (loadedFor.current) { setSnapshot(undefined); setDraft(undefined); setCollection(undefined); setShop(undefined); }
      void load();
    }
    return () => { active.current = false; generation.current += 1; };
  }, [load, client, requestKey]));

  const coinSources = useMemo(() => coinCollection?.catalog.flatMap((merchant) => merchant.types.flatMap((type) =>
    type.grades.flatMap((grade) => grade.sources.filter((source) => source.sourceKind !== 'VISIT').map((source) => ({ source, merchantName: merchant.merchantName,
      displayName: grade.name, campaignTitle: type.name }))))) ?? [], [coinCollection]);
  const selected = useMemo(() => {
    if (!draft || !collection) return [];
    const owned = new Map(collection.collectibles.map((item) => [item.entitlementId, item]));
    const legacy = draft.slots.flatMap((id) => { const item = owned.get(id); return item ? [itemFromCollection(item)] : []; });
    const sources = draft.coinSlots?.flatMap((selectedSource) => {
      const saved = snapshot?.coinItems.find((item) => item.sourceKind === selectedSource.sourceKind && item.sourceId === selectedSource.sourceId);
      if (saved) return [{ merchantId: saved.merchantId, merchantName: saved.merchantName,
        campaignTitle: '가게 코인', displayName: saved.name, sourceKind: selectedSource.sourceKind, sourceId: selectedSource.sourceId,
        ...(saved.artwork ? { artwork: saved.artwork } : {}) }];
      const entry = coinSources.find(({ source }) => source.sourceKind === selectedSource.sourceKind && source.sourceId === selectedSource.sourceId);
      if (entry) return [{ merchantId: entry.source.merchantId, merchantName: entry.merchantName,
        campaignTitle: entry.campaignTitle, displayName: entry.displayName,
        sourceKind: entry.source.sourceKind, sourceId: entry.source.sourceId }];
      return [];
    }) ?? [];
    return [...legacy, ...sources];
  }, [draft, collection, coinSources, snapshot]);
  const representativeCoin = collection?.collectibles.find((item) => item.entitlementId === experience.snapshot?.profile.coinEntitlementId);
  const representativeSource = experience.snapshot?.profile.representativeCoin;
  const representativeItem: StudioItem | undefined = representativeCoin ? itemFromCollection(representativeCoin)
    : representativeSource ? { merchantId: representativeSource.merchantId, merchantName: representativeSource.merchantName,
      campaignTitle: representativeSource.campaignTitle, displayName: representativeSource.displayName,
      ...(experience.snapshot?.profile.coinSource ? { sourceKind: experience.snapshot.profile.coinSource.sourceKind,
        sourceId: experience.snapshot.profile.coinSource.sourceId } : {}),
      ...(representativeSource.artwork ? { artwork: representativeSource.artwork } : {}) } : undefined;
  const options = useMemo(() => snapshot && collection ? studioGoalOptions(merchants, collection, snapshot.records) : [], [merchants, collection, snapshot]);
  const wantedGoal = draft?.goal?.kind === 'collectible' ? draft.goal : undefined;
  useEffect(() => {
    if (!wantedGoal?.merchantId) return;
    const controller = new AbortController();
    void fetchCollectiblePreview(apiUrl, wantedGoal.merchantId, fetch, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setWantedPreview({ merchantId: wantedGoal.merchantId!, goalPublicationId: wantedGoal.publicationId!, preview: value }); })
      .catch(() => { if (!controller.signal.aborted) setWantedPreview({ merchantId: wantedGoal.merchantId!, goalPublicationId: wantedGoal.publicationId!, preview: null, error: true }); });
    return () => controller.abort();
  }, [apiUrl, wantedGoal?.merchantId, wantedGoal?.campaignId, wantedGoal?.publicationId]);
  const currentWantedPreview = wantedPreview && wantedGoal && wantedPreview.merchantId === wantedGoal.merchantId
    && wantedPreview.goalPublicationId === wantedGoal.publicationId ? wantedPreview : undefined;
  const wantedStatus = wantedGoal && collection ? resolveStudioGoal(wantedGoal, merchants, collection, goalNow,
    currentWantedPreview?.preview ?? undefined) : undefined;
  const clothingPreview = useMemo(() => shop ? { clothing: { ...shop.clothing, equipped: clothingChoice } } : undefined, [shop, clothingChoice]);
  const clothingArt = useEquippedClothingArt(clothingPreview);
  const dirty = !!draft && !!snapshot && studioDirty(snapshot.studio, draft);
  usePreventRemove(dirty && !allowRemoval, ({ data }) => {
    pendingRemoval.current = data.action;
    setShowDiscard(true);
  });
  useEffect(() => {
    if (!allowRemoval || !pendingRemoval.current) return;
    const action = pendingRemoval.current;
    pendingRemoval.current = null;
    navigation.dispatch(action);
    const rearm = setTimeout(() => { if (mounted.current) setAllowRemoval(false); }, 0);
    return () => clearTimeout(rearm);
  }, [allowRemoval, navigation]);
  const goalAvailable = !draft?.goal || options.some((option) => JSON.stringify(option.goal) === JSON.stringify(draft.goal))
    || draft.goal.kind === 'collectible' && JSON.stringify(draft.goal) === JSON.stringify(snapshot?.studio.goal);

  async function save() {
    if (!draft || saving || !goalAvailable) return;
    const submitted = draft;
    setSaving(true); setError(undefined); setErrorNeedsConsent(false); setNotice(undefined);
    await runStudioSave(() => client.save(submitted, snapshot?.revision), {
      isMounted: () => mounted.current,
      canApply: () => currentClient.current === client,
      onSuccess: (saved) => { setSnapshot(saved); setDraft((current) => studioAfterSave(submitted, current, saved.studio)); setNotice('요청한 배치를 내 공간에 저장했어요.'); },
      onError: (caught) => { setError(caught instanceof Error && 'status' in caught && caught.status === 409
        ? '다른 기기에서 방이 바뀌었어요. 현재 편집을 취소하고 새로 불러와 주세요.' : studioErrorMessage(caught)); setErrorNeedsConsent(needsConsentRecheck(caught)); },
      onSettled: () => setSaving(false),
    });
  }

  async function saveAvatar() {
    if (avatarSaving || !shop || !shop.items.some((item) => item.id === avatarChoice && item.owned)) return;
    setAvatarSaving(true); setError(undefined); setErrorNeedsConsent(false); setNotice(undefined);
    const request = generation.current;
    await runStudioSave(() => shopClient.setAvatar(avatarChoice), {
      isMounted: () => mounted.current,
      canApply: () => active.current && request === generation.current,
      onSuccess: (result) => {
        setSnapshot((current) => current ? { ...current, avatar: result.avatar } : current);
        setShop((current) => current ? { ...current, avatar: result.avatar } : current);
        setNotice('동행을 바꿨어요.');
      },
      onError: (caught) => { setError(studioErrorMessage(caught)); setErrorNeedsConsent(needsConsentRecheck(caught)); },
      onSettled: () => setAvatarSaving(false),
    });
  }

  async function saveClothing() {
    if (clothingSaving || !shop || (clothingChoice !== null && !shop.clothing.items.some((item) => item.id === clothingChoice && item.owned))) return;
    setClothingSaving(true); setError(undefined); setErrorNeedsConsent(false); setNotice(undefined);
    const request = generation.current;
    await runStudioSave(() => shopClient.setClothing(clothingChoice), {
      isMounted: () => mounted.current,
      canApply: () => active.current && request === generation.current,
      onSuccess: (result) => {
        setClothingChoice(result.equippedClothing);
        setShop((current) => current ? {
          ...current,
          clothing: {
            ...current.clothing,
            equipped: result.equippedClothing,
            items: current.clothing.items.map((item) => ({ ...item, equipped: item.id === result.equippedClothing })),
          },
        } : current);
        setNotice(result.equippedClothing ? '동행 옷을 바꿨어요.' : '동행 옷을 벗겼어요.');
      },
      onError: (caught) => { setError(studioErrorMessage(caught)); setErrorNeedsConsent(needsConsentRecheck(caught)); },
      onSettled: () => setClothingSaving(false),
    });
  }

  function toggleSlot(id: string) {
    if (!draft || saving) return;
    if (!draft.slots.includes(id) && draft.slots.length + (draft.coinSlots?.length ?? 0) >= 6) {
      setNotice('수집품은 최대 6개까지 놓을 수 있어요.');
      return;
    }
    const slots = draft.slots.includes(id) ? draft.slots.filter((slot) => slot !== id) : [...draft.slots, id];
    setNotice(undefined);
    setDraft({ ...draft, slots });
  }

  function toggleCoinSource(source: StudioCoinSource) {
    if (!draft || saving) return;
    const exists = draft.coinSlots?.some((item) => item.sourceKind === source.sourceKind && item.sourceId === source.sourceId);
    if (!exists && draft.slots.length + (draft.coinSlots?.length ?? 0) >= 6) { setNotice('수집품은 최대 6개까지 놓을 수 있어요.'); return; }
    setDraft({ ...draft, coinSlots: exists ? draft.coinSlots?.filter((item) => item.sourceKind !== source.sourceKind || item.sourceId !== source.sourceId)
      : [...(draft.coinSlots ?? []), source] });
  }

  function chooseGoal(goal: StudioGoal) { setDraft((current) => current ? { ...current, goal } : current); }
  function refreshIfClean() {
    if (dirty || saving) { setNotice('저장하지 않은 편집이 있어요. 저장하거나 편집 취소 후 새로고침해 주세요.'); return; }
    void load(true);
  }
  function cancelEdits() {
    if (!snapshot || !shop || saving) return;
    setDraft(snapshot.studio); setSelectedFurnitureId(undefined); setEditingFurniture(false);
    setAvatarChoice(snapshot.avatar); setClothingChoice(shop.clothing.equipped); setPreview(null);
    setError(undefined); setNotice('저장하지 않은 편집을 취소했어요.');
  }
  const leave = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace('/'); }, [router]);
  const header = <BackHeader title="내 공간" onBack={leave} />;
  if (loading && !snapshot) return <SkyBackdrop><SkyScrollView header={header}><StateScene kind="loading" title="공간을 불러오는 중" /></SkyScrollView></SkyBackdrop>;
  if (!snapshot || !draft || !collection || !shop) return <SkyBackdrop><SkyScrollView header={header}><StateScene kind="error" title="공간을 열지 못했어요" body={error} action={{ label: errorNeedsConsent ? consentRecheckLabel : '다시 불러오기', onPress: errorNeedsConsent ? recheckConsent : () => void load() }} /></SkyScrollView></SkyBackdrop>;
  const owned = collection.collectibles;
  const page = ownedPage(owned, collectionPage);
  return <SkyBackdrop>
    <SkyScrollView header={header} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshIfClean} progressViewOffset={insets.top} />}>
      <View style={styles.sceneFrame}>
        <StudioScene studio={draft} items={selected} avatar={avatarChoice} clothing={clothingArt} apiUrl={apiUrl} width={sceneWidth} height={Math.round(sceneWidth * 0.80)}
          furniture={furniture} furnitureItems={snapshot.furnitureItems} selectedFurnitureId={selectedFurnitureId}
          onFurnitureSelect={editingFurniture && !saving ? setSelectedFurnitureId : undefined}
          onFurnitureMove={editingFurniture && !saving ? (id, x, y) => setDraft((current) => current ? changeFurniture(current, id, (placement) => ({ ...placement, x, y })) : current) : undefined}
          experienceProfile={previewProfile ?? experience.snapshot?.profile}
          representativeCoin={representativeItem}
          badgeName={experience.snapshot?.catalog.badges.find((badge) => badge.id === experience.snapshot?.profile.badgeId)?.name}
          onItemPress={(item) => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: item.merchantId } })} />
      </View>
      <Text style={[styles.hint, { color: palette.secondaryLabel }]}>{selected.length}/6개 전시 · 동행 {shop.items.find((item) => item.id === avatarChoice)?.name ?? '기본 마스코트'} · 옷 {shop.clothing.items.find((item) => item.id === clothingChoice)?.name ?? '없음'}</Text>
      <View style={styles.saveRow}>
        <Pressable accessibilityRole="button" disabled={saving || (!dirty && avatarChoice === snapshot.avatar && clothingChoice === shop.clothing.equipped && !previewProfile)}
          onPress={cancelEdits} style={[styles.cancel, { backgroundColor: palette.surface, borderColor: palette.separator }]}>
          <Text style={[styles.cancelText, { color: palette.secondaryLabel }]}>취소</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={!dirty || saving || !goalAvailable} onPress={() => void save()}
          style={[styles.save, { backgroundColor: !dirty || saving || !goalAvailable ? palette.surface : palette.primary, borderWidth: 1, borderColor: palette.separator }]}>
          <Text style={[styles.saveText, { color: saving || !dirty || !goalAvailable ? palette.secondaryLabel : palette.onPrimary }]}>{saving ? '저장 중…' : '내 공간 저장'}</Text>
        </Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.error }]}>{error}</Text> : null}
      {errorNeedsConsent ? <Pressable accessibilityRole="button" onPress={recheckConsent} style={styles.goButton}><Text style={styles.goText}>{consentRecheckLabel}</Text></Pressable> : null}
      {notice ? <Text accessibilityRole="alert" style={[styles.notice, { color: palette.success }]}>{notice}</Text> : null}
      <View accessibilityRole="radiogroup" style={styles.modeChoices}>{studioModes.map((option) => <Pressable key={option.id}
        accessibilityRole="radio" accessibilityState={{ checked: mode === option.id }} onPress={() => setModeChoice({ requestKey, mode: option.id })}
        style={[styles.modeChoice, { backgroundColor: mode === option.id ? palette.primaryContainer : palette.surface,
          borderColor: mode === option.id ? palette.primary : palette.separator }]}>
        <Text style={[styles.modeText, { color: mode === option.id ? palette.onPrimaryContainer : palette.label }]}>{option.label}</Text>
      </Pressable>)}</View>
      <Text style={[styles.visibilityNote, { color: palette.secondaryLabel }]}>방 공개 범위는 공개 설정에서 확인하고 바꿀 수 있어요.</Text>
      {mode === 'room' ? <>
      <View style={styles.section}>
        <Text style={[styles.heading, { color: palette.label }]}>가구 배치 · 벽과 바닥</Text>
        <Text style={[styles.hint, { color: palette.secondaryLabel }]}>보유한 가구를 방에 놓고 끌어서 옮기세요. 변경 사항은 내 공간 저장을 누르면 반영돼요.</Text>
        {furnitureError ? <Pressable accessibilityRole="button" onPress={refreshIfClean} style={styles.choice}><Text style={styles.choiceText}>보관함을 불러오지 못했어요 · 다시 시도</Text></Pressable> : null}
        {furniture ? <>
          <Pressable accessibilityRole="button" onPress={() => setEditingFurniture((current) => !current)} style={[styles.choice, editingFurniture && styles.choiceSelected]}>
            <Text style={styles.choiceText}>{editingFurniture ? '배치 편집 닫기' : '가구 배치 편집'}</Text>
          </Pressable>
          {editingFurniture ? <>
            <View style={styles.choices}>{ownedFurniture(furniture, 'FURNITURE').map((entry) => <Pressable key={entry.id}
              accessibilityRole="button" accessibilityState={{ disabled: draft.furniture.some((placed) => placed.inventoryId === entry.id) }}
              disabled={draft.furniture.some((placed) => placed.inventoryId === entry.id)}
              onPress={() => { setDraft(placeFurniture(draft, entry.id, furniture)); setSelectedFurnitureId(entry.id); }}
              style={[styles.choice, draft.furniture.some((placed) => placed.inventoryId === entry.id) && styles.locked]}>
              <Text style={styles.choiceText}>{entry.item.name} 배치</Text>
            </Pressable>)}</View>
            {!ownedFurniture(furniture, 'FURNITURE').length ? <Text style={[styles.emptyText, { color: palette.secondaryLabel }]}>보관 중인 가구가 없어요. 상품은 가격과 판매 정책이 정해진 뒤 구매할 수 있어요.</Text> : null}
            {selectedFurnitureId && draft.furniture.some((placed) => placed.inventoryId === selectedFurnitureId) ? <View style={styles.choices}>
              {([['왼쪽', -.04, 0], ['오른쪽', .04, 0], ['위로', 0, -.04], ['아래로', 0, .04]] as const).map(([label, dx, dy]) => <Pressable key={label}
                accessibilityRole="button" accessibilityLabel={`선택한 가구 ${label} 이동`} onPress={() => setDraft(changeFurniture(draft, selectedFurnitureId, (placed) => ({ ...placed,
                  x: clampPosition(placed.x + dx), y: clampPosition(placed.y + dy) })))} style={styles.choice}>
                <Text style={styles.choiceText}>{label}</Text></Pressable>)}
              <Pressable accessibilityRole="button" onPress={() => setDraft(changeFurniture(draft, selectedFurnitureId, (placed) => ({ ...placed, rotation: ((placed.rotation + 90) % 360) as 0 | 90 | 180 | 270 })))} style={styles.choice}><Text style={styles.choiceText}>90° 회전</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => { setDraft(removeFurniture(draft, selectedFurnitureId)); setSelectedFurnitureId(undefined); }} style={styles.choice}><Text style={styles.choiceText}>보관함으로</Text></Pressable>
            </View> : null}
            {(['wall', 'floor'] as const).map((surface) => <View key={surface}>
              <Text style={[styles.subheading, { color: palette.label }]}>{surface === 'wall' ? '벽' : '바닥'}</Text>
              <View style={styles.choices}><Pressable accessibilityRole="radio" accessibilityState={{ checked: draft[surface] === null }}
                onPress={() => setDraft({ ...draft, [surface]: null })} style={styles.choice}><Text style={styles.choiceText}>기본</Text></Pressable>
                {(['daylight', 'garden', 'evening'] as const).filter((theme) => theme === 'daylight' || snapshot.unlockedThemes.includes(theme)).map((theme) => <Pressable key={theme} accessibilityRole="radio"
                  accessibilityState={{ selected: draft[surface] === theme }} onPress={() => setDraft({ ...draft, [surface]: theme })} style={styles.choice}>
                  <Text style={styles.choiceText}>{themeLabels[theme]}</Text></Pressable>)}</View>
            </View>)}
          </> : null}
          <Pressable accessibilityRole="button" onPress={() => router.push('/room-inventory')} style={styles.choice}><Text style={styles.choiceText}>보관함 보기 ›</Text></Pressable>
        </> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="내 방 공개와 월계 방 탐험 설정" onPress={() => router.push('/room-explore')}
        style={[styles.section, { backgroundColor: palette.primaryContainer, borderRadius: 16, padding: 16 }]}>
        <Text style={[styles.heading, { color: palette.onPrimaryContainer }]}>이웃에게 내 방 보여주기 ›</Text>
        <Text style={[styles.hint, { color: palette.secondaryLabel }]}>저장된 공개 범위와 방문자를 확인해요.</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/appearance')} style={styles.choice}>
        <Text style={styles.choiceText}>하단 바 꾸미기 ›</Text>
      </Pressable>
      </> : null}
      {mode === 'companion' ? <>
      {experience.error ? <Pressable accessibilityRole="button" onPress={() => void experience.refresh()}><Text style={styles.rowMeta}>{experience.error} · 다시 확인</Text></Pressable> : null}
      {previewProfile ? <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: palette.secondaryLabel }]}>착용 미리보기 · 아직 저장하지 않았어요. 공유에는 저장된 장비가 보여요.</Text> : null}
      <View style={styles.section} pointerEvents={avatarSaving || clothingSaving ? 'none' : 'auto'}>
        <Text style={[styles.heading, { color: palette.label }]}>동행과 의상</Text>
        {shop.items.some((item) => item.owned) ? <View style={styles.avatarList}>{shop.items.filter((item) => item.owned).map((item) => <Pressable
          key={item.id} accessibilityRole="radio" accessibilityLabel={`${item.name} 동행 선택`}
          accessibilityState={{ selected: avatarChoice === item.id }} onPress={() => setAvatarChoice(item.id)}
          style={[styles.avatarOption, avatarChoice === item.id && styles.rowSelected]}>
          {friendArt[item.id] ? <Image source={friendArt[item.id]} style={styles.avatarImage} resizeMode="contain" /> : null}
          <Text numberOfLines={2} style={styles.avatarName}>{item.name}</Text>
        </Pressable>)}</View> : <Text style={[styles.emptyText, { color: palette.secondaryLabel }]}>아직 뽑은 동행이 없어요.</Text>}
        {avatarChoice !== snapshot.avatar ? <Pressable accessibilityRole="button" disabled={avatarSaving} onPress={() => void saveAvatar()} style={styles.avatarSave}>
          <Text style={styles.avatarSaveText}>{avatarSaving ? '동행 저장 중…' : '이 동행으로 저장'}</Text>
        </Pressable> : null}
        <Text style={[styles.subheading, { color: palette.secondaryLabel }]}>동행 옷</Text>
        <View style={styles.avatarList}>
          <Pressable key="none" accessibilityRole="radio" accessibilityLabel="옷 입히지 않기"
            accessibilityState={{ selected: clothingChoice === null }} onPress={() => setClothingChoice(null)}
            style={[styles.clothingOption, clothingChoice === null && styles.rowSelected]}>
            <View style={styles.noClothingBadge}><Text style={styles.noClothingText}>—</Text></View>
            <Text numberOfLines={2} style={styles.avatarName}>없음</Text>
          </Pressable>
          {shop.clothing.items.filter((item) => item.owned).map((item) => <Pressable
            key={item.id} accessibilityRole="radio" accessibilityLabel={`${item.name} 착용 선택`}
            accessibilityState={{ selected: clothingChoice === item.id }} onPress={() => setClothingChoice(item.id)}
            style={[styles.clothingOption, clothingChoice === item.id && styles.rowSelected]}>
            <View style={styles.clothingBadge}><AvatarWardrobe clothing={clothingArtForId(item.id)} size={42} /></View>
            <Text numberOfLines={2} style={styles.avatarName}>{item.name}</Text>
          </Pressable>)}
        </View>
        {shop.clothing.items.some((item) => item.owned) ? null : <Text style={[styles.emptyText, { color: palette.secondaryLabel }]}>아직 받은 옷이 없어요. 상점 뽑기에서 얻을 수 있어요.</Text>}
        {clothingChoice !== shop.clothing.equipped ? <Pressable accessibilityRole="button" disabled={clothingSaving} onPress={() => void saveClothing()} style={styles.avatarSave}>
          <Text style={styles.avatarSaveText}>{clothingSaving ? '옷 저장 중…' : '이 옷으로 저장'}</Text>
        </Pressable> : null}
      </View>
      {experience.snapshot ? <Fold title="새 꾸미기와 해금 조건" summary="보유 장식과 도전 목표" >
        <ExperienceWardrobe snapshot={experience.snapshot} saving={experience.saving} avatar={avatarChoice} clothing={clothingArt}
          onPreview={(profile) => setPreview(profile && experience.snapshot ? { profile, source: experience.snapshot.profile, avatar: avatarChoice, client } : null)}
          onEquip={(equipment) => void experience.save(equipment).then((saved) => { if (saved) setPreview(null); })} onWish={(itemId) => void experience.wish(itemId)} />
      </Fold> : null}
      </> : null}
      {mode === 'coins' ? <>
      {experience.snapshot && owned.length ? <View style={styles.section}>
        <Text style={[styles.heading, { color: palette.label }]}>대표 수집 코인</Text>
        <View style={styles.choices}>{page.items.map((item) => <Pressable key={item.entitlementId}
          accessibilityRole="button" accessibilityState={{ selected: experience.snapshot?.profile.coinEntitlementId === item.entitlementId }}
          disabled={experience.saving} onPress={() => void experience.save({ coinEntitlementId: experience.snapshot?.profile.coinEntitlementId === item.entitlementId ? null : item.entitlementId })}
          style={[styles.choice, experience.snapshot?.profile.coinEntitlementId === item.entitlementId && styles.choiceSelected]}>
          <Text style={styles.choiceText}>{item.displayName}</Text>
        </Pressable>)}</View>
      </View> : null}
      </> : null}
      {mode === 'room' ? <>
      <View style={styles.section} pointerEvents={saving ? 'none' : 'auto'}>
        <Text style={[styles.heading, { color: palette.label }]}>장면</Text>
        <View style={styles.choices}>
          {(['daylight', 'evening', 'garden'] as const).map((theme) => {
            const unlocked = theme === 'daylight' || snapshot.unlockedThemes.includes(theme);
            return <Pressable key={theme} accessibilityRole="button" accessibilityState={{ selected: draft.theme === theme, disabled: !unlocked }}
              disabled={!unlocked} onPress={() => setDraft({ ...draft, theme })}
              style={[styles.choice, draft.theme === theme && styles.choiceSelected, !unlocked && styles.locked]}>
              <Text style={styles.choiceText}>{themeLabels[theme]}{unlocked ? '' : ' · 잠김'}</Text>
            </Pressable>;
          })}
        </View>
        <Text style={[styles.subheading, { color: palette.secondaryLabel }]}>배치</Text>
        <View style={styles.choices}>
          {(['shelf', 'gallery'] as const).map((layout) => <Pressable key={layout} accessibilityRole="button" accessibilityState={{ selected: draft.layout === layout }}
            onPress={() => setDraft({ ...draft, layout })} style={[styles.choice, draft.layout === layout && styles.choiceSelected]}>
            <Text style={styles.choiceText}>{layout === 'shelf' ? '선반' : '갤러리'}</Text>
          </Pressable>)}
        </View>
        <Text style={[styles.subheading, { color: palette.secondaryLabel }]}>포인트 색</Text>
        <View style={styles.choices}>
          {(['mint', 'rose', 'sky'] as const).map((accent) => <Pressable key={accent} accessibilityRole="button" accessibilityLabel={`${accent === 'mint' ? '민트' : accent === 'rose' ? '로즈' : '스카이'} 색`}
            accessibilityState={{ selected: draft.accent === accent }} onPress={() => setDraft({ ...draft, accent })}
            style={[styles.swatch, { backgroundColor: accentColors[accent] }, draft.accent === accent && styles.swatchSelected]} />)}
        </View>
      </View>
      </> : null}
      {mode === 'coins' ? <>
      <View style={styles.section} pointerEvents={saving ? 'none' : 'auto'}>
        <Text style={[styles.heading, { color: palette.label }]}>내 수집품</Text>
        {coinCollectionError ? <Pressable accessibilityRole="button" onPress={refreshIfClean} style={styles.choice}><Text style={styles.choiceText}>가게 코인을 불러오지 못했어요 · 다시 시도</Text></Pressable> : null}
        {coinSources.length ? <>
          <Text style={[styles.subheading, { color: palette.secondaryLabel }]}>가게 코인</Text>
          {coinSources.slice(coinPage * 12, coinPage * 12 + 12).map(({ source, merchantName, displayName }) => {
            const checked = draft.coinSlots?.some((item) => item.sourceKind === source.sourceKind && item.sourceId === source.sourceId) ?? false;
            return <View key={`${source.sourceKind}:${source.sourceId}`} style={styles.goalRow}><Pressable accessibilityRole="checkbox" accessibilityState={{ checked }}
              onPress={() => toggleCoinSource({ sourceKind: source.sourceKind, sourceId: source.sourceId })}
              style={[styles.row, styles.ownedRow, checked && styles.rowSelected, { flex: 1 }]}>
              <Text style={styles.checkbox}>{checked ? '✓' : '+'}</Text>
              <View style={styles.rowText}><Text style={styles.rowTitle}>{displayName}</Text><Text style={styles.rowMeta}>{merchantName}</Text></View>
            </Pressable><Pressable accessibilityRole="button" disabled={experience.saving}
              onPress={() => void experience.save({ coinSource: { sourceKind: source.sourceKind, sourceId: source.sourceId } })}
              style={styles.goButton}><Text style={styles.goText}>대표</Text></Pressable></View>;
          })}
          {coinSources.length > 12 ? <View style={styles.choices}>
            <Pressable accessibilityRole="button" disabled={coinPage === 0} onPress={() => setCoinPage((page) => page - 1)} style={styles.choice}><Text style={styles.choiceText}>이전</Text></Pressable>
            <Text style={styles.rowMeta}>{coinPage + 1}/{Math.ceil(coinSources.length / 12)}</Text>
            <Pressable accessibilityRole="button" disabled={(coinPage + 1) * 12 >= coinSources.length} onPress={() => setCoinPage((page) => page + 1)} style={styles.choice}><Text style={styles.choiceText}>다음</Text></Pressable>
          </View> : null}
        </> : null}
        {owned.length ? <View style={styles.list}>{page.items.map((item) => {
          const selectedItem = draft.slots.includes(item.entitlementId);
          return <Pressable key={item.entitlementId} accessibilityRole="checkbox" accessibilityState={{ checked: selectedItem }}
            onPress={() => toggleSlot(item.entitlementId)} style={[styles.row, styles.ownedRow, selectedItem && styles.rowSelected]}>
            <Text style={styles.checkbox}>{selectedItem ? '✓' : '+'}</Text>
            <View style={styles.rowText}><Text style={styles.rowTitle}>{item.displayName}</Text><Text style={styles.rowMeta}>{item.merchantName}</Text></View>
          </Pressable>;
        })}
          {page.totalPages > 1 ? <View style={styles.pagination}>
            <Text accessibilityLiveRegion="polite" style={[styles.rowMeta, { color: palette.secondaryLabel }]}>{page.page + 1}/{page.totalPages}쪽 · 총 {owned.length}개</Text>
            <View style={styles.choices}>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !page.hasPrevious }} disabled={!page.hasPrevious}
                onPress={() => setCollectionPage(page.page - 1)} style={[styles.choice, !page.hasPrevious && styles.locked]}><Text style={styles.choiceText}>이전 수집품</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !page.hasNext }} disabled={!page.hasNext}
                onPress={() => setCollectionPage(page.page + 1)} style={[styles.choice, !page.hasNext && styles.locked]}><Text style={styles.choiceText}>더 보기</Text></Pressable>
            </View>
          </View> : null}
        </View> : <Text style={[styles.emptyText, { color: palette.secondaryLabel }]}>아직 받은 수집품이 없어요. 가게에서 첫 방문 도장을 모아 보세요.</Text>}
      </View>
      </> : null}
      {mode === 'goal' ? <>
      <View style={styles.section} pointerEvents={saving ? 'none' : 'auto'}>
        <Text style={[styles.heading, { color: palette.label }]}>다음 목표</Text>
        {merchantError ? <View style={styles.goalRow}>
          <Text style={[styles.rowMeta, styles.catalogError]}>가게 목표를 불러오지 못했어요.</Text>
          <Pressable accessibilityRole="button" onPress={() => void retryMerchants()} style={styles.goButton}><Text style={styles.goText}>다시 불러오기</Text></Pressable>
        </View> : null}
        {!goalAvailable ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.error }]}>이전 목표 가게를 지금은 선택할 수 없어요. 새 목표를 골라 주세요.</Text> : null}
        {wantedStatus ? <View style={styles.goalRow}>
          <Text accessibilityRole="alert" style={styles.rowMeta}>{wantedStatus.status === 'completed' ? wantedStatus.label
            : !currentWantedPreview ? '현재 수집품 획득 경로 확인 중…'
            : currentWantedPreview.error ? '현재 수집품 경로를 확인하지 못했어요. 아래로 당겨 다시 확인해 주세요.'
            : wantedStatus.label}</Text>
          {wantedGoal?.merchantId ? <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: wantedGoal.merchantId! } })} style={styles.goButton}><Text style={styles.goText}>획득 경로 확인</Text></Pressable> : null}
        </View> : null}
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: !draft.goal }} onPress={() => chooseGoal(null)} style={[styles.row, !draft.goal && styles.rowSelected]}>
          <Text style={styles.rowTitle}>아직 정하지 않기</Text>
        </Pressable>
        {options.map((option) => {
          const selectedGoal = JSON.stringify(draft.goal) === JSON.stringify(option.goal);
          return <View key={`${option.goal.kind}:${option.merchantId ?? option.goal.gameKind}`} style={[styles.goalRow, selectedGoal && styles.rowSelected]}>
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: selectedGoal }} onPress={() => chooseGoal(option.goal)} style={styles.goalPick}>
              <Text numberOfLines={2} style={styles.rowTitle}>{option.label}</Text><Text style={styles.rowMeta}>{option.progress}</Text>
            </Pressable>
            {option.merchantId ? <Pressable accessibilityRole="button" accessibilityLabel={`${option.label} 가게 보기`}
              onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: option.merchantId! } })} style={styles.goButton}><Text style={styles.goText}>가게 보기</Text></Pressable> : null}
          </View>;
        })}
      </View>
      <View style={styles.section}>
        <Text style={[styles.heading, { color: palette.label }]}>공유 이미지·영상</Text>
        <ShareFormatButtons disabled={share.sharing} onShare={(format, media) => {
          const request = generation.current;
          setShareStatus(undefined);
          void share.share(draft, selected, avatarChoice, format, media, experience.snapshot?.profile,
            experience.snapshot?.catalog.badges.find((badge) => badge.id === experience.snapshot?.profile.badgeId)?.name,
            representativeItem, equippedClothingArt(shop), furniture)
            .then((outcome) => {
              if (!active.current || request !== generation.current) return;
              setShareTone(outcome === 'saved' ? 'success' : 'neutral');
              setShareStatus({ shared: '공유 창을 열었어요.', saved: `${media === 'video' ? '영상을' : '이미지를'} 저장했어요.`,
                cancelled: '공유가 취소됐어요.', unavailable: `이 기기에서는 ${media === 'video' ? '영상' : '이미지'} 내보내기를 사용할 수 없어요.` }[outcome]);
            })
            .catch(() => { if (active.current && request === generation.current) { setShareTone('error'); setShareStatus('내보내지 못했어요. 다시 시도해 주세요.'); } });
        }} />
        {shareStatus ? <Text accessibilityRole="alert" style={[styles.notice, { color: shareTone === 'success' ? palette.success : shareTone === 'error' ? palette.error : palette.secondaryLabel }]}>{shareStatus}</Text> : null}
      </View>
      </> : null}
      {share.host}
      <ConfirmDialog visible={showDiscard} title="편집을 취소할까요?" message="저장하지 않은 방 꾸미기는 사라져요."
        confirmLabel="편집 취소" cancelLabel="계속 편집"
        onCancel={() => { pendingRemoval.current = null; setShowDiscard(false); }}
        onConfirm={() => { setShowDiscard(false); setAllowRemoval(true); }} />
    </SkyScrollView>
  </SkyBackdrop>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingBottom: 40, gap: 14 },
  sceneFrame: { alignItems: 'center', borderRadius: 6, overflow: 'hidden' },
  avatarList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  avatarOption: { width: 91, minHeight: 103, alignItems: 'center', justifyContent: 'center', padding: 5, borderWidth: 1, borderColor: '#DBE3EC', borderRadius: 6, backgroundColor: '#FFFFFF' },
  avatarImage: { width: 62, height: 62 }, avatarName: { color: '#263A52', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  clothingOption: { width: 91, minHeight: 84, alignItems: 'center', justifyContent: 'center', padding: 5, borderWidth: 1, borderColor: '#DBE3EC', borderRadius: 6, backgroundColor: '#FFFFFF' },
  clothingBadge: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  noClothingBadge: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F5F9', borderColor: '#DCE5EF', borderWidth: 1 },
  noClothingText: { color: '#6B7A8F', fontWeight: '900', fontSize: 20 },
  avatarSave: { minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EAF1FF', borderRadius: 6 },
  avatarSaveText: { color: '#2456D6', fontSize: 14, fontWeight: '800' },
  hint: { color: '#58677D', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  visibilityNote: { color: '#58677D', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  saveRow: { flexDirection: 'row', gap: 8 },
  cancel: { minHeight: 50, minWidth: 96, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1DDD7', borderRadius: 14 },
  cancelText: { color: '#164F4A', fontSize: 15, fontWeight: '800' },
  modeChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeChoice: { flexBasis: '48%', flexGrow: 1, minHeight: 52, borderWidth: 1, borderRadius: 13, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 7 },
  modeText: { fontSize: 14, fontWeight: '800', textAlign: 'center' },
  section: { gap: 10, paddingVertical: 7 },
  heading: { fontSize: 19, fontWeight: '800', color: '#192331' },
  subheading: { fontSize: 14, fontWeight: '700', color: '#42556B', marginTop: 4 },
  choices: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  choice: { minHeight: 44, minWidth: 76, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#CBD8E8', borderRadius: 6, paddingHorizontal: 13, backgroundColor: '#FFFFFF' },
  choiceSelected: { borderColor: '#2456D6', backgroundColor: '#EAF1FF' },
  choiceText: { color: '#23334B', fontSize: 14, fontWeight: '700' },
  locked: { opacity: 0.45 },
  swatch: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: '#FFFFFF' },
  swatchSelected: { borderColor: '#24374E', borderWidth: 4 },
  list: { gap: 7 }, pagination: { gap: 8 }, ownedRow: { paddingVertical: 8 },
  row: { minHeight: 55, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#DBE3EC', borderRadius: 6, paddingHorizontal: 12, backgroundColor: '#FFFFFF' },
  rowSelected: { borderColor: '#78B8B3', backgroundColor: '#EDF8F5' },
  checkbox: { fontSize: 22, fontWeight: '800', color: '#2456D6', width: 22, textAlign: 'center' },
  rowText: { flex: 1 }, rowTitle: { fontSize: 14, fontWeight: '800', color: '#24344A' }, rowMeta: { fontSize: 12, color: '#58677D', marginTop: 3 },
  goalRow: { flexDirection: 'row', alignItems: 'center', minHeight: 58, borderWidth: 1, borderColor: '#DBE3EC', borderRadius: 6, backgroundColor: '#FFFFFF' },
  catalogError: { flex: 1, paddingHorizontal: 12 },
  goalPick: { flex: 1, minHeight: 55, justifyContent: 'center', paddingHorizontal: 12 },
  goButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderLeftWidth: 1, borderLeftColor: '#DBE3EC' },
  goText: { color: '#2456D6', fontWeight: '800', fontSize: 12 },
  emptyText: { color: '#58677D', fontSize: 14, lineHeight: 21 },
  error: { color: '#9A371D', fontSize: 13, lineHeight: 19 }, notice: { color: '#276B51', fontSize: 13, fontWeight: '700' },
  save: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: '#087F73', borderRadius: 14 },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
