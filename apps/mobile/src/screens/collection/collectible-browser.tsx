import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Image, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import Animated, { measure, useAnimatedReaction, useAnimatedRef, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { collectibleFilterOptions, filterAndSortAlbum, type CollectibleFilter, type CollectibleSort } from './collectible-filters';
import { collectionCardLayout, earnedDateLabel } from './collectible-groups';
import type { CollectibleGroup, UngroupedCollectible } from './collectible-groups';
import { useCollectionStyles } from './use-collection-styles';
import { canOfferMint, chainLabel, nftGroupSummary, nftPreparingNote, nftStatusLabel, shortAddress } from './nft-status';
import { collectibleArtNote } from '@/merchant-art/art-source';
import { useArtFallback } from '@/merchant-art/use-art-fallback';
import { merchantArt } from './merchant-art';
import { legacyCollectibleDetail, type LegacyCollectibleDetail } from './legacy-collectible-detail';
import { seriesSlotText, type StoreSeries } from './store-series';
import type { ActiveWalletBindingResponse } from '@/wallet/wallet-api';
import type { CollectionSnapshot } from '@/commerce/commerce-api';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { FloatingCard } from '@/ui/floating-card';
import { useMotionEnabled } from '@/motion/use-motion';
import { gradeMaterialFor } from './grade-material';
import { GradeMaterialLayer, useGradeMaterialClock } from './grade-material-layer';
import { uiMetrics } from '@/theme/ui-metrics';

type NftMinting = CollectionSnapshot['nftMinting'];
type NftStatus = CollectionSnapshot['collectibles'][number]['nftStatus'];
type NftAsset = CollectionSnapshot['collectibles'][number]['nft'];

const sortOptions: readonly { value: CollectibleSort; label: string }[] = [
  { value: 'recent', label: '최신순' },
  { value: 'store', label: '가게순' },
  { value: 'grade', label: '등급순' },
];


type MintGate = {
  apiUrl: string;
  nftMinting: NftMinting;
  binding: ActiveWalletBindingResponse['binding'] | undefined;
  busyEntitlementId: string | undefined;
  onConfirmMint: (entitlementId: string) => void;
};

export function CollectibleBrowser({ groups, legacy, artUrlByMerchant, favorites, series, sharing, mint, materialScrollY, materialVisible, onToggleFavorite, onOpenDetail, onShare }: {
  groups: readonly CollectibleGroup[];
  /** Entitlements with no published picture (#296): merged into this same album so every collectible appears once. */
  legacy: readonly UngroupedCollectible[];
  /** A legacy card's own merchant picture, same lookup the screen already builds for the stamp board. */
  artUrlByMerchant: ReadonlyMap<string, string | null | undefined>;
  favorites: readonly string[];
  series: readonly StoreSeries[];
  sharing: boolean;
  mint: MintGate;
  materialScrollY: SharedValue<number>;
  materialVisible: boolean;
  onToggleFavorite: (key: string) => void;
  onOpenDetail: (entitlementId: string, merchantName: string, localDetail?: LegacyCollectibleDetail) => void;
  onShare: (group: CollectibleGroup) => void;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const { fontScale, width: windowWidth } = useWindowDimensions();
  // 격자의 실제 폭을 재서 카드 폭을 정한다(재기 전에는 화면 폭에서 좌우 여백을 뺀 값으로 시작한다).
  const [gridWidth, setGridWidth] = useState(windowWidth - uiMetrics.pageInset * 2);
  const cardWidth = collectionCardLayout(gridWidth, fontScale).width;
  const [filter, setFilter] = useState<CollectibleFilter>({});
  const [sort, setSort] = useState<CollectibleSort>('recent');
  const motionEnabled = useMotionEnabled();
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const favoriteScrollX = useSharedValue(0);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  // 목록 전체가 하나의 UI 스레드 시계를 읽는다. 축소 모션·탭 이탈·백그라운드에서는 멈춘다.
  const materialActive = motionEnabled && focused && foreground && materialVisible;
  const materialClock = useGradeMaterialClock(materialActive);
  const options = useMemo(() => collectibleFilterOptions(groups, legacy), [groups, legacy]);
  // #296 review: filter and sort the grouped and legacy (no-picture) cards together, so the store filter also
  // hides other stores' legacy cards and "newest first" holds across the whole album, not just within groups.
  const shown = useMemo(() => filterAndSortAlbum(groups, legacy, filter, sort), [groups, legacy, filter, sort]);
  const favoriteGroups = useMemo(() => favorites.map((key) => groups.find((group) => group.key === key)).filter((group): group is CollectibleGroup => !!group), [favorites, groups]);

  if (groups.length === 0 && legacy.length === 0 && series.length === 0) {
    return <Text style={[styles.empty, { color: world.cardMuted, backgroundColor: world.card }]}>다시 볼 수 있는 가게 수집품을 받으면 여기 모여요.</Text>;
  }

  return (
    <View style={{ gap: 16 }}>
      {favoriteGroups.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={[styles.subtitle, { color: world.skyInk }]}>앨범 즐겨찾기</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={16}
            onScroll={(event) => favoriteScrollX.set(event.nativeEvent.contentOffset.x)} contentContainerStyle={{ gap: 10 }}>
            {favoriteGroups.map((group) => (
              <Pressable key={group.key} accessibilityRole="button" accessibilityLabel={`앨범 즐겨찾기의 ${group.artwork.name} 상세 보기`}
                onPress={() => onOpenDetail(group.entitlementIds[0]!, group.merchantName)} style={[styles.favoriteCard, { backgroundColor: world.card }]}>
                <MaterialThumbnail material={gradeMaterialFor(group.artwork.gradeId, group.artwork.gradeName)}
                  size={80} faceUri={group.artwork.thumbnailDataUrl} shape={group.artwork.shape}
                  clock={materialClock} scrollY={materialScrollY} horizontalScroll={favoriteScrollX} active={materialActive}>
                  <Image source={{ uri: group.artwork.thumbnailDataUrl }} resizeMode="contain" style={StyleSheet.absoluteFill} accessible={false} />
                </MaterialThumbnail>
                <Text numberOfLines={2} style={[styles.favoriteName, { color: world.cardInk }]}>{group.artwork.name}</Text>
                <Text style={[styles.favoriteGrade, { color: world.cardMuted }]}>{group.artwork.gradeName}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {groups.length > 0 || legacy.length > 0 ? (
        <View style={{ gap: 10 }}>
          <FilterRow label="가게" selected={filter.merchantId} onSelect={(value) => setFilter((current) => ({ ...current, merchantId: value }))}
            options={options.merchants.map((merchant) => ({ value: merchant.id, label: merchant.name }))} palette={palette} world={world} />
          {options.themes.length > 1 ? (
            <FilterRow label="시즌" selected={filter.theme} onSelect={(value) => setFilter((current) => ({ ...current, theme: value }))}
              options={options.themes.map((theme) => ({ value: theme, label: theme }))} palette={palette} world={world} />
          ) : null}
          {options.grades.length > 1 ? (
            <FilterRow label="등급" selected={filter.gradeId} onSelect={(value) => setFilter((current) => ({ ...current, gradeId: value }))}
              options={options.grades.map((grade) => ({ value: grade.id, label: grade.name }))} palette={palette} world={world} />
          ) : null}
          <View style={styles.sortRow}>
            {sortOptions.map((option) => (
              <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: sort === option.value }}
                onPress={() => setSort(option.value)}
                style={[styles.sortChip, { borderColor: palette.primary }, sort === option.value && { backgroundColor: palette.primary }]}>
                <Text style={[styles.sortChipText, { color: sort === option.value ? palette.onPrimary : palette.primary }]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.grid} onLayout={(event) => setGridWidth(Math.floor(event.nativeEvent.layout.width))}>
            {shown.map((entry) => entry.kind === 'group' ? (
              <GroupCard key={entry.group.key} group={entry.group} favorites={favorites} sharing={sharing} mint={mint}
                cardWidth={cardWidth}
                materialClock={materialClock} materialScrollY={materialScrollY} materialActive={materialActive}
                onToggleFavorite={onToggleFavorite} onOpenDetail={onOpenDetail} onShare={onShare} />
            ) : (
              <LegacyCard key={entry.item.entitlementId} item={entry.item} mint={mint} onOpenDetail={onOpenDetail}
                cardWidth={cardWidth}
                materialClock={materialClock} materialScrollY={materialScrollY} materialActive={materialActive} artUrl={artUrlByMerchant.get(entry.item.merchantId)} />
            ))}
          </View>
        </View>
      ) : null}

      {series.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={[styles.subtitle, { color: world.skyInk }]}>가게별 시리즈</Text>
          {series.map((store) => (
            <FloatingCard key={store.merchantId} style={[styles.seriesCard, { backgroundColor: world.card }]}>
              <Text style={[styles.groupName, { color: world.cardInk }]}>{store.merchantName}</Text>
              <View style={styles.seriesSlots}>
                {store.slots.map((slot) => slot.owned ? (
                  <View key={slot.targetVisitCount} style={[styles.seriesSlot, { borderColor: palette.primary, backgroundColor: palette.primaryContainer }]}>
                    <Text style={[styles.seriesSlotText, { color: palette.onPrimaryContainer }]}>{seriesSlotText(slot)}</Text>
                  </View>
                ) : (
                  <Link key={slot.targetVisitCount} href={{ pathname: '/merchants/[merchantId]', params: { merchantId: store.merchantId, from: 'collection' } }} asChild>
                    <Pressable accessibilityRole="link" accessibilityLabel={`${store.merchantName}, ${seriesSlotText(slot)}, 가게 보기`}
                      style={StyleSheet.flatten([styles.seriesSlot, { borderColor: palette.separator, backgroundColor: 'transparent' }])}>
                      <Text style={[styles.seriesSlotText, { color: world.cardMuted }]}>{seriesSlotText(slot)}</Text>
                    </Pressable>
                  </Link>
                ))}
              </View>
              {store.completed ? (
                <Text style={[styles.seriesNext, { color: palette.primary }]}>시리즈를 모두 모았어요!</Text>
              ) : store.nextSlot ? (
                <Text style={[styles.seriesNext, { color: world.cardMuted }]}>다음 목표 · {seriesSlotText(store.nextSlot)}</Text>
              ) : null}
            </FloatingCard>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function FilterRow({ label, options, selected, onSelect, palette, world }: {
  label: string;
  options: readonly { value: string; label: string }[];
  selected: string | undefined;
  onSelect: (value: string | undefined) => void;
  palette: ReturnType<typeof colorsForScheme>;
  world: ReturnType<typeof worldForScheme>;
}) {
  if (options.length <= 1) return null;
  return (
    <View style={styles.filterRow}>
      <Text style={[styles.filterLabel, { color: world.skyMuted }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {options.map((option) => {
          const active = selected === option.value;
          return (
            <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: active }}
              onPress={() => onSelect(active ? undefined : option.value)}
              style={[styles.filterChip, { borderColor: palette.primary }, active && { backgroundColor: palette.primary }]}>
              <Text style={[styles.filterChipText, { color: active ? palette.onPrimary : palette.primary }]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** A grouped (pictured) album card: the picture, count badge, favorite/share actions, and its NFT status row. */
function GroupCard({ group, favorites, sharing, mint, cardWidth, materialClock, materialScrollY, materialActive, onToggleFavorite, onOpenDetail, onShare }: {
  group: CollectibleGroup;
  favorites: readonly string[];
  sharing: boolean;
  mint: MintGate;
  cardWidth: number;
  materialClock: SharedValue<number>;
  materialScrollY: SharedValue<number>;
  materialActive: boolean;
  onToggleFavorite: (key: string) => void;
  onOpenDetail: (entitlementId: string, merchantName: string, localDetail?: LegacyCollectibleDetail) => void;
  onShare: (group: CollectibleGroup) => void;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const material = gradeMaterialFor(group.artwork.gradeId, group.artwork.gradeName);
  return (
    <FloatingCard style={[styles.groupCard, { width: cardWidth }, { backgroundColor: world.card }]}
      accessibilityLabel={`${group.artwork.name}, ${group.merchantName}, ${group.artwork.gradeName}${group.count > 1 ? `, ${group.count}개 보유` : ''}`}
      onPress={() => onOpenDetail(group.entitlementIds[0]!, group.merchantName)}>
      <View style={styles.groupImageFrame}>
        <MaterialThumbnail material={material} size={104} faceUri={group.artwork.thumbnailDataUrl} shape={group.artwork.shape}
          clock={materialClock} scrollY={materialScrollY} active={materialActive}>
          <Image source={{ uri: group.artwork.thumbnailDataUrl }} resizeMode="contain" style={styles.groupImage} accessible={false} />
        </MaterialThumbnail>
        {group.count > 1 ? (
          <View style={[styles.countBadge, { backgroundColor: palette.primary }]}>
            <Text style={[styles.countBadgeText, { color: palette.onPrimary }]}>{group.count}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={[styles.groupName, { color: world.cardInk }]}>{group.artwork.name}</Text>
      <Text numberOfLines={2} style={[styles.groupMeta, { color: world.cardMuted }]}>{group.artwork.gradeName} · {group.merchantName}</Text>
      <Text style={[styles.groupDates, { color: world.cardMuted }]}>
        {group.count > 1 ? `받은 날짜 ${group.earnedDates.map(earnedDateLabel).join(', ')}` : `받은 날짜 ${earnedDateLabel(group.earnedDates[0]!)}`}
      </Text>
      <View style={styles.groupActions}>
        <Pressable accessibilityRole="button" accessibilityLabel={favorites.includes(group.key) ? '앨범 즐겨찾기에서 빼기' : '앨범 즐겨찾기에 추가'}
          onPress={() => onToggleFavorite(group.key)} style={[styles.groupActionButton, { borderColor: palette.primary }]}>
          <Text style={[styles.groupActionText, { color: palette.primary }]}>{favorites.includes(group.key) ? '즐겨찾기 해제' : '즐겨찾기'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${group.artwork.name} 공유하기`} disabled={sharing}
          onPress={() => onShare(group)} style={[styles.groupActionButton, { borderColor: palette.primary }, sharing && { opacity: 0.5 }]}>
          <Text style={[styles.groupActionText, { color: palette.primary }]}>공유</Text>
        </Pressable>
      </View>
      <NftStatusRow entitlements={group.entitlements} mint={mint} />
    </FloatingCard>
  );
}

/**
 * #296: per-entitlement NFT status inside the album card. A duplicate group (the same picture earned twice) can have
 * entries at different mint stages, so the badge summarizes them (`nftGroupSummary`) and the mint action — kept
 * reachable here rather than only in a detail screen — targets the first entitlement still eligible.
 * ponytail: one mint button mints the first eligible duplicate, not a per-duplicate list; add a full per-entitlement
 * picker if someone needs to choose which specific copy to mint.
 */
function NftStatusRow({ entitlements, mint }: { entitlements: readonly { entitlementId: string; nftStatus: NftStatus; nft: NftAsset; recipient: string | null }[]; mint: MintGate }) {
  const collectionStyles = useCollectionStyles();
  const palette = colorsForScheme(useColorScheme());
  const [expanded, setExpanded] = useState(false);
  const summary = nftGroupSummary(entitlements, mint.nftMinting);
  const mintable = entitlements.find((entry) => canOfferMint(entry.nftStatus, mint.nftMinting));
  const solo = entitlements.length === 1 ? entitlements[0] : undefined;
  const busy = mintable ? mint.busyEntitlementId === mintable.entitlementId : false;
  return (
    <View style={[collectionStyles.nftRow, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
      <View style={styles.nftSummary}>
        <Text style={collectionStyles.nftLabel}>실제 NFT</Text>
        <Text style={collectionStyles.nftValue}>{summary}</Text>
      </View>
      {solo?.recipient ? <Text selectable style={collectionStyles.recipient}>수령인 {shortAddress(solo.recipient)}</Text> : null}
      {solo?.nft ? (
        <Text selectable style={collectionStyles.nftIdentity}>{chainLabel(solo.nft.chainId)} · {shortAddress(solo.nft.contractAddress)} · #{solo.nft.tokenId}</Text>
      ) : null}
      {solo && solo.nftStatus !== 'FINALIZED' && mint.nftMinting === 'PREPARING' ? (
        <Text style={collectionStyles.itemMeta}>{nftPreparingNote}</Text>
      ) : null}
      {entitlements.length > 1 ? (
        <>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? '묶인 수집품 각자 정보 접기' : '묶인 수집품 각자 정보 보기'}
            onPress={() => setExpanded((value) => !value)} style={[styles.groupActionButton, { borderColor: palette.primary, alignSelf: 'flex-start' }]}>
            <Text style={[styles.groupActionText, { color: palette.primary }]}>{expanded ? '각자 정보 접기 ▲' : '각자 정보 보기 ▼'}</Text>
          </Pressable>
          {expanded ? (
            <View style={{ gap: 6 }}>
              {entitlements.map((entry, index) => (
                <View key={entry.entitlementId} style={{ gap: 2 }}>
                  <Text style={collectionStyles.itemMeta}>#{index + 1} · {nftStatusLabel(entry.nftStatus, mint.nftMinting)}</Text>
                  {entry.recipient ? <Text selectable style={collectionStyles.recipient}>수령인 {shortAddress(entry.recipient)}</Text> : null}
                  {entry.nft ? (
                    <Text selectable style={collectionStyles.nftIdentity}>{chainLabel(entry.nft.chainId)} · {shortAddress(entry.nft.contractAddress)} · #{entry.nft.tokenId}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      {mintable ? (
        mint.binding ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => mint.onConfirmMint(mintable.entitlementId)}
            style={[collectionStyles.mintButton, { backgroundColor: palette.primary }, busy && collectionStyles.disabled]}>
            <Text style={collectionStyles.mintButtonText}>{busy ? '접수 중…' : '양도 제한 NFT 받기'}</Text>
          </Pressable>
        ) : (
          <Link href="/wallet" asChild>
            {/* #314: expo-router의 Slot은 asChild 자식에 배열 style을 넘기면 렌더 오류를 던진다(경고가 아니다). */}
            <Pressable accessibilityRole="button" style={StyleSheet.flatten([collectionStyles.walletButton, { borderColor: palette.primary }])}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={collectionStyles.walletButtonText}>외부 지갑 주소 확인</Text>
            </Pressable>
          </Link>
        )
      ) : null}
    </View>
  );
}

/** A collectible earned without a published picture (#296): shown in the same grid, using the merchant's own art as a fallback. */
function LegacyCard({ item, mint, artUrl, cardWidth, materialClock, materialScrollY, materialActive, onOpenDetail }: {
  item: UngroupedCollectible; mint: MintGate; artUrl: string | null | undefined; cardWidth: number;
  materialClock: SharedValue<number>; materialScrollY: SharedValue<number>; materialActive: boolean;
  onOpenDetail: (entitlementId: string, merchantName: string, localDetail?: LegacyCollectibleDetail) => void;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const world = worldForScheme(scheme);
  const art = merchantArt({ id: item.merchantId, artUrl }, mint.apiUrl);
  const { source, onError } = useArtFallback(art?.source);
  const detail = legacyCollectibleDetail(item, source);
  const material = gradeMaterialFor(detail.gradeId, detail.gradeName);
  return (
    <FloatingCard style={[styles.groupCard, { width: cardWidth }, { backgroundColor: world.card }]}
      accessibilityLabel={`${item.displayName}, ${item.merchantName}, ${item.targetVisitCount}회 목표 상세 보기`}
      onPress={() => onOpenDetail(item.entitlementId, item.merchantName, legacyCollectibleDetail(item, source))}>
      {art && source ? (
        <View style={styles.groupImageFrame}>
          <MaterialThumbnail material={material} size={104} shape={detail.shape}
            faceUri={Image.resolveAssetSource(source)?.uri}
            clock={materialClock} scrollY={materialScrollY} active={materialActive}>
            <Image source={source} onError={onError} resizeMode="contain" style={styles.groupImage} accessible={false} />
          </MaterialThumbnail>
        </View>
      ) : null}
      <Text numberOfLines={2} style={[styles.groupName, { color: world.cardInk }]}>{item.displayName}</Text>
      <Text numberOfLines={2} style={[styles.groupMeta, { color: world.cardMuted }]}>{detail.gradeName} · {item.merchantName} · {item.targetVisitCount}회</Text>
      {art ? <Text style={[styles.groupDates, { color: world.cardMuted }]}>{collectibleArtNote(art.fromServer)}</Text> : null}
      <Text style={[styles.groupDates, { color: world.cardMuted }]}>받은 날짜 {earnedDateLabel(item.earnedAt)}</Text>
      <NftStatusRow entitlements={[item]} mint={mint} />
    </FloatingCard>
  );
}

function MaterialThumbnail({ material, size, faceUri, shape, clock, scrollY, horizontalScroll, active, children }: {
  material: ReturnType<typeof gradeMaterialFor>; size: number; faceUri?: string; shape: string;
  clock: SharedValue<number>; scrollY: SharedValue<number>; horizontalScroll?: SharedValue<number>;
  active: boolean; children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const ref = useAnimatedRef<View>();
  const layoutRevision = useSharedValue(0);
  const [visible, setVisible] = useState(false);
  useAnimatedReaction(
    () => ({ scroll: scrollY.get(), horizontal: horizontalScroll?.get() ?? 0, layout: layoutRevision.get() }),
    () => {
      const box = measure(ref);
      const inView = !!box && box.pageX < width && box.pageX + box.width > 0
        && box.pageY < height && box.pageY + box.height > 0;
      // 스크롤마다 React를 갱신하지 않고 화면 진입·이탈 경계에서만 구독을 전환한다.
      if (inView !== visible) scheduleOnRN(setVisible, inView);
    },
    [width, height, visible],
  );
  return <Animated.View ref={ref} onLayout={() => layoutRevision.set((value) => value + 1)}
    style={{ width: size, height: size }}>
    {children}
    <GradeMaterialLayer material={material} size={size} faceUri={faceUri} shape={shape} variant="card"
      clock={clock} active={active && visible && (material === 'gold' || material === 'prism')} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  empty: { padding: 18, borderRadius: 20, fontSize: 14, lineHeight: 22 },
  subtitle: { fontSize: 17, fontWeight: '800' },
  favoriteCard: { width: 108, borderRadius: 16, padding: 10, gap: 6, alignItems: 'center' },
  favoriteImage: { width: 80, height: 80 },
  favoriteName: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  favoriteGrade: { fontSize: 11, textAlign: 'center' },
  filterRow: { gap: 6 },
  filterLabel: { fontSize: 12, fontWeight: '800' },
  filterChip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  filterChipText: { fontSize: 12, fontWeight: '800' },
  sortRow: { flexDirection: 'row', gap: 8 },
  sortChip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sortChipText: { fontSize: 12, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  groupCard: { borderRadius: 18, padding: 12, gap: 5 },
  groupImageFrame: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  groupImage: { width: 104, height: 104 },
  countBadge: { position: 'absolute', top: 0, right: 8, minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  countBadgeText: { fontSize: 11, fontWeight: '900' },
  groupName: { fontSize: 14, fontWeight: '900' },
  groupMeta: { fontSize: 11 },
  groupDates: { fontSize: 10, lineHeight: 14 },
  nftSummary: { alignItems: 'flex-start', gap: 2 },
  groupActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  groupActionButton: { minHeight: 30, paddingHorizontal: 9, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  groupActionText: { fontSize: 11, fontWeight: '800' },
  seriesCard: { borderRadius: 18, padding: 14, gap: 8 },
  seriesSlots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  seriesSlot: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  seriesSlotText: { fontSize: 11, fontWeight: '800' },
  seriesNext: { fontSize: 12, fontWeight: '700' },
});
