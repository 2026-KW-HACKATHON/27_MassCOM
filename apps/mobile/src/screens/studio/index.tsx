import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';
import { getAppPackageId } from '@/config/app-identity';
import { createMerchantApiClient, type PublicMerchant } from '@/merchant/merchant-api';
import { createShopApiClient, type ShopSnapshot } from '@/shop/shop-api';
import { friendArt } from '@/shop/shop-art';
import { StudioScene } from '@/studio/studio-scene';
import { ShareFormatButtons, useStudioShare } from '@/studio/studio-share';
import { createStudioApiClient, type Studio, type StudioGoal, type StudioItem, type StudioSnapshot, type StudioTheme } from '@/studio/studio-api';
import { studioGoalOptions } from '@/studio/studio-goals';
import { ownedPage, ownedPageSize } from '@/studio/owned-page';
import { runStudioSave } from '@/studio/studio-save';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

const themeLabels: Record<StudioTheme, string> = { daylight: '낮', evening: '저녁', garden: '정원' };
const accentColors = { mint: '#68BAAC', rose: '#E78F9B', sky: '#72A7E6' } as const;

function itemFromCollection(item: CollectionSnapshot['collectibles'][number]): StudioItem {
  return {
    entitlementId: item.entitlementId, merchantId: item.merchantId, merchantName: item.merchantName,
    campaignTitle: item.campaignTitle, displayName: item.displayName, artwork: item.artwork,
  };
}

function studioError(error: unknown): string {
  if (error instanceof Error && error.message === 'NETWORK_ERROR') return '연결을 확인하고 다시 시도해 주세요.';
  if (error instanceof Error && error.message === 'INVALID_STUDIO') return '공간 정보가 올바르지 않아요. 다시 불러와 주세요.';
  return '공간을 불러오거나 저장하지 못했어요. 다시 시도해 주세요.';
}

export function StudioScreen({ apiUrl, credential, onSessionInvalid, requestedEntitlement, requestedAvatar }: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>;
  requestedEntitlement?: string; requestedAvatar?: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const appId = getAppPackageId();
  const palette = colorsForScheme(useColorScheme());
  const { width } = useWindowDimensions();
  const sceneWidth = Math.min(Math.max(width - 28, 280), 460);
  const client = useMemo(() => createStudioApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const collectionClient = useMemo(() => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const shopClient = useMemo(() => createShopApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const merchantClient = useMemo(() => createMerchantApiClient(apiUrl), [apiUrl]);
  const [snapshot, setSnapshot] = useState<StudioSnapshot>();
  const [collection, setCollection] = useState<CollectionSnapshot>();
  const [shop, setShop] = useState<ShopSnapshot>();
  const [merchants, setMerchants] = useState<readonly PublicMerchant[]>([]);
  const [merchantError, setMerchantError] = useState(false);
  const [draft, setDraft] = useState<Studio>();
  const [avatarChoice, setAvatarChoice] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [shareStatus, setShareStatus] = useState<string>();
  const [collectionPage, setCollectionPage] = useState(0);
  const mounted = useRef(false);
  const active = useRef(false);
  const generation = useRef(0);
  const share = useStudioShare(apiUrl, useCallback(() => active.current, []),
    appId === 'kr.masscom.wolgye.demo' || appId === 'kr.masscom.wolgye.dev' || credential.kind === 'demo',
    useCallback((event) => { if (active.current) void client.trackShare(event).catch(() => {}); }, [client]));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async (refresh = false) => {
    const request = ++generation.current;
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(undefined);
    try {
      const [studio, owned, shopSnapshot, catalog] = await Promise.all([
        client.getMine(), collectionClient.getCollection(), shopClient.getShop(),
        merchantClient.listMerchants().then((items) => ({ items, failed: false as const }))
          .catch(() => ({ items: [] as readonly PublicMerchant[], failed: true as const })),
      ]);
      if (!active.current || request !== generation.current) return;
      setSnapshot(studio); setCollection(owned); setShop(shopSnapshot); setMerchants(catalog.items);
      setMerchantError(catalog.failed);
      const requestedIndex = owned.collectibles.findIndex((item) => item.entitlementId === requestedEntitlement);
      setCollectionPage(Math.floor(Math.max(0, requestedIndex) / ownedPageSize));
      const canPlace = requestedEntitlement && owned.collectibles.some((item) => item.entitlementId === requestedEntitlement);
      const needsPlace = canPlace && !studio.studio.slots.includes(requestedEntitlement);
      setDraft(needsPlace && studio.studio.slots.length < 6
        ? { ...studio.studio, slots: [...studio.studio.slots, requestedEntitlement] } : studio.studio);
      setAvatarChoice(requestedAvatar && shopSnapshot.items.some((item) => item.id === requestedAvatar && item.owned)
        ? requestedAvatar : studio.avatar);
      setNotice(needsPlace && studio.studio.slots.length >= 6 ? '전시가 가득 찼어요. 다른 수집품을 빼고 골라 주세요.' : undefined);
    } catch (caught) {
      if (active.current && request === generation.current) setError(studioError(caught));
    } finally {
      if (active.current && request === generation.current) { setLoading(false); setRefreshing(false); }
    }
  }, [client, collectionClient, shopClient, merchantClient, requestedEntitlement, requestedAvatar]);

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
    void load();
    return () => { active.current = false; generation.current += 1; };
  }, [load]));

  const selected = useMemo(() => {
    if (!draft || !collection) return [];
    const owned = new Map(collection.collectibles.map((item) => [item.entitlementId, item]));
    return draft.slots.flatMap((id) => { const item = owned.get(id); return item ? [itemFromCollection(item)] : []; });
  }, [draft, collection]);
  const options = useMemo(() => snapshot && collection ? studioGoalOptions(merchants, collection, snapshot.records) : [], [merchants, collection, snapshot]);
  const dirty = !!draft && !!snapshot && JSON.stringify(draft) !== JSON.stringify(snapshot.studio);
  const goalAvailable = !draft?.goal || options.some((option) => JSON.stringify(option.goal) === JSON.stringify(draft.goal));

  async function save() {
    if (!draft || saving || !goalAvailable) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    const request = generation.current;
    await runStudioSave(() => client.save(draft), {
      isMounted: () => mounted.current,
      canApply: () => active.current && request === generation.current,
      onSuccess: (saved) => { setSnapshot(saved); setDraft(saved.studio); setNotice('내 공간에 저장했어요.'); },
      onError: (caught) => setError(studioError(caught)),
      onSettled: () => setSaving(false),
    });
  }

  async function saveAvatar() {
    if (avatarSaving || !shop || !shop.items.some((item) => item.id === avatarChoice && item.owned)) return;
    setAvatarSaving(true); setError(undefined); setNotice(undefined);
    const request = generation.current;
    await runStudioSave(() => shopClient.setAvatar(avatarChoice), {
      isMounted: () => mounted.current,
      canApply: () => active.current && request === generation.current,
      onSuccess: (result) => {
        setSnapshot((current) => current ? { ...current, avatar: result.avatar } : current);
        setShop((current) => current ? { ...current, avatar: result.avatar } : current);
        setNotice('동행을 바꿨어요.');
      },
      onError: (caught) => setError(studioError(caught)),
      onSettled: () => setAvatarSaving(false),
    });
  }

  function toggleSlot(id: string) {
    if (!draft || saving) return;
    if (!draft.slots.includes(id) && draft.slots.length >= 6) {
      setNotice('수집품은 최대 6개까지 놓을 수 있어요.');
      return;
    }
    const slots = draft.slots.includes(id) ? draft.slots.filter((slot) => slot !== id) : [...draft.slots, id];
    setNotice(undefined);
    setDraft({ ...draft, slots });
  }

  function chooseGoal(goal: StudioGoal) { setDraft((current) => current ? { ...current, goal } : current); }
  const header = <BackHeader title="내 공간" />;
  if (loading && !snapshot) return <SkyBackdrop><SkyScrollView header={header}><StateScene kind="loading" title="공간을 불러오는 중" /></SkyScrollView></SkyBackdrop>;
  if (!snapshot || !draft || !collection || !shop) return <SkyBackdrop><SkyScrollView header={header}><StateScene kind="error" title="공간을 열지 못했어요" body={error} action={{ label: '다시 불러오기', onPress: () => void load() }} /></SkyScrollView></SkyBackdrop>;
  const owned = collection.collectibles;
  const page = ownedPage(owned, collectionPage);
  return <SkyBackdrop>
    <SkyScrollView header={header} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} progressViewOffset={insets.top} />}>
      <View style={styles.sceneFrame}>
        <StudioScene studio={draft} items={selected} avatar={avatarChoice} apiUrl={apiUrl} width={sceneWidth} height={Math.round(sceneWidth * 0.92)}
          onItemPress={(item) => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: item.merchantId } })} />
      </View>
      <Text style={[styles.hint, { color: palette.secondaryLabel }]}>{selected.length}/6개 전시 · 동행 {shop.items.find((item) => item.id === avatarChoice)?.name ?? '기본 마스코트'}</Text>
      <Text style={[styles.visibilityNote, { color: palette.secondaryLabel }]}>저장한 동행과 수집품은 친구 공간에 바로 보여요.</Text>
      <View style={styles.section} pointerEvents={avatarSaving ? 'none' : 'auto'}>
        <Text style={[styles.heading, { color: palette.label }]}>동행</Text>
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
      </View>
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
      <View style={styles.section} pointerEvents={saving ? 'none' : 'auto'}>
        <Text style={[styles.heading, { color: palette.label }]}>내 수집품</Text>
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
      <View style={styles.section} pointerEvents={saving ? 'none' : 'auto'}>
        <Text style={[styles.heading, { color: palette.label }]}>다음 목표</Text>
        {merchantError ? <View style={styles.goalRow}>
          <Text style={[styles.rowMeta, styles.catalogError]}>가게 목표를 불러오지 못했어요.</Text>
          <Pressable accessibilityRole="button" onPress={() => void retryMerchants()} style={styles.goButton}><Text style={styles.goText}>다시 불러오기</Text></Pressable>
        </View> : null}
        {!goalAvailable ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.error }]}>이전 목표 가게를 지금은 선택할 수 없어요. 새 목표를 골라 주세요.</Text> : null}
        <Pressable accessibilityRole="radio" accessibilityState={{ selected: !draft.goal }} onPress={() => chooseGoal(null)} style={[styles.row, !draft.goal && styles.rowSelected]}>
          <Text style={styles.rowTitle}>아직 정하지 않기</Text>
        </Pressable>
        {options.map((option) => {
          const selectedGoal = JSON.stringify(draft.goal) === JSON.stringify(option.goal);
          return <View key={`${option.goal.kind}:${option.merchantId ?? option.goal.gameKind}`} style={[styles.goalRow, selectedGoal && styles.rowSelected]}>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: selectedGoal }} onPress={() => chooseGoal(option.goal)} style={styles.goalPick}>
              <Text numberOfLines={2} style={styles.rowTitle}>{option.label}</Text><Text style={styles.rowMeta}>{option.progress}</Text>
            </Pressable>
            {option.merchantId ? <Pressable accessibilityRole="button" accessibilityLabel={`${option.label} 가게 보기`}
              onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: option.merchantId! } })} style={styles.goButton}><Text style={styles.goText}>가게 보기</Text></Pressable> : null}
          </View>;
        })}
      </View>
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.error }]}>{error}</Text> : null}
      {notice ? <Text accessibilityRole="alert" style={[styles.notice, { color: palette.success }]}>{notice}</Text> : null}
      <Pressable accessibilityRole="button" disabled={!dirty || saving || !goalAvailable} onPress={() => void save()} style={[styles.save, (!dirty || saving || !goalAvailable) && styles.locked]}>
        <Text style={styles.saveText}>{saving ? '저장 중…' : '내 공간 저장'}</Text>
      </Pressable>
      <View style={styles.section}>
        <Text style={[styles.heading, { color: palette.label }]}>공유 이미지</Text>
        <ShareFormatButtons disabled={share.sharing} onShare={(format) => {
          setShareStatus(undefined);
          void share.share(draft, selected, avatarChoice, format)
            .then((outcome) => {
              if (!active.current) return;
              setShareStatus({ shared: '공유 창을 열었어요.', saved: '이미지를 저장했어요.',
                cancelled: '공유가 취소됐어요.', unavailable: '이 기기에서는 이미지 내보내기를 사용할 수 없어요.' }[outcome]);
            })
            .catch(() => { if (active.current) setShareStatus('이미지를 내보내지 못했어요. 다시 시도해 주세요.'); });
        }} />
        {shareStatus ? <Text accessibilityRole="alert" style={[styles.notice, { color: palette.success }]}>{shareStatus}</Text> : null}
      </View>
      {share.host}
    </SkyScrollView>
  </SkyBackdrop>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingBottom: 40, gap: 14 },
  sceneFrame: { alignItems: 'center', borderRadius: 6, overflow: 'hidden' },
  avatarList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  avatarOption: { width: 91, minHeight: 103, alignItems: 'center', justifyContent: 'center', padding: 5, borderWidth: 1, borderColor: '#DBE3EC', borderRadius: 6, backgroundColor: '#FFFFFF' },
  avatarImage: { width: 62, height: 62 }, avatarName: { color: '#263A52', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  avatarSave: { minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EAF1FF', borderRadius: 6 },
  avatarSaveText: { color: '#2456D6', fontSize: 14, fontWeight: '800' },
  hint: { color: '#58677D', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  visibilityNote: { color: '#58677D', fontSize: 12, lineHeight: 18, textAlign: 'center' },
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
  save: { minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2456D6', borderRadius: 6 },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
