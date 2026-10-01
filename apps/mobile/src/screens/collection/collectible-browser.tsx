import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { collectibleFilterOptions, filterCollectibleGroups, sortCollectibleGroups, type CollectibleFilter, type CollectibleSort } from './collectible-filters';
import type { CollectibleGroup, UngroupedCollectible } from './collectible-groups';
import { useCollectionStyles } from './use-collection-styles';
import { canOfferMint, chainLabel, nftGroupSummary, nftPreparingNote, shortAddress } from './nft-status';
import { collectibleArtNote } from '@/merchant-art/art-source';
import { useArtFallback } from '@/merchant-art/use-art-fallback';
import { merchantArt } from './merchant-art';
import { seriesSlotText, type StoreSeries } from './store-series';
import type { ActiveWalletBindingResponse } from '@/wallet/wallet-api';
import type { CollectionSnapshot } from '@/commerce/commerce-api';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { FloatingCard } from '@/ui/floating-card';

type NftMinting = CollectionSnapshot['nftMinting'];
type NftStatus = CollectionSnapshot['collectibles'][number]['nftStatus'];
type NftAsset = CollectionSnapshot['collectibles'][number]['nft'];

const sortOptions: readonly { value: CollectibleSort; label: string }[] = [
  { value: 'recent', label: '최신순' },
  { value: 'store', label: '가게순' },
  { value: 'grade', label: '등급순' },
];

function earnedDateLabel(iso: string): string {
  return iso.slice(0, 10);
}

type MintGate = {
  apiUrl: string;
  nftMinting: NftMinting;
  binding: ActiveWalletBindingResponse['binding'] | undefined;
  busyEntitlementId: string | undefined;
  onConfirmMint: (entitlementId: string) => void;
};

export function CollectibleBrowser({ groups, legacy, artUrlByMerchant, favorites, series, sharing, mint, onToggleFavorite, onOpenDetail, onShare }: {
  groups: readonly CollectibleGroup[];
  /** Entitlements with no published picture (#296): merged into this same album so every collectible appears once. */
  legacy: readonly UngroupedCollectible[];
  /** A legacy card's own merchant picture, same lookup the screen already builds for the stamp board. */
  artUrlByMerchant: ReadonlyMap<string, string | null | undefined>;
  favorites: readonly string[];
  series: readonly StoreSeries[];
  sharing: boolean;
  mint: MintGate;
  onToggleFavorite: (key: string) => void;
  onOpenDetail: (entitlementId: string, merchantName: string) => void;
  onShare: (group: CollectibleGroup) => void;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const [filter, setFilter] = useState<CollectibleFilter>({});
  const [sort, setSort] = useState<CollectibleSort>('recent');
  const options = useMemo(() => collectibleFilterOptions(groups), [groups]);
  const shown = useMemo(() => sortCollectibleGroups(filterCollectibleGroups(groups, filter), sort), [groups, filter, sort]);
  const favoriteGroups = useMemo(() => favorites.map((key) => groups.find((group) => group.key === key)).filter((group): group is CollectibleGroup => !!group), [favorites, groups]);

  if (groups.length === 0 && legacy.length === 0 && series.length === 0) {
    return <Text style={[styles.empty, { color: world.cardMuted, backgroundColor: world.card }]}>다시 볼 수 있는 가게 수집품을 받으면 여기 모여요.</Text>;
  }

  return (
    <View style={{ gap: 16 }}>
      {favoriteGroups.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={[styles.subtitle, { color: world.skyInk }]}>대표 진열</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {favoriteGroups.map((group) => (
              <Pressable key={group.key} accessibilityRole="button" accessibilityLabel={`대표로 놓은 ${group.artwork.name} 상세 보기`}
                onPress={() => onOpenDetail(group.entitlementIds[0]!, group.merchantName)} style={[styles.favoriteCard, { backgroundColor: world.card }]}>
                <Image source={{ uri: group.artwork.thumbnailDataUrl }} resizeMode="contain" style={styles.favoriteImage} accessible={false} />
                <Text numberOfLines={1} style={[styles.favoriteName, { color: world.cardInk }]}>{group.artwork.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {groups.length > 0 || legacy.length > 0 ? (
        <View style={{ gap: 10 }}>
          {groups.length > 0 ? (
            <>
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
            </>
          ) : null}

          <View style={styles.grid}>
            {shown.map((group) => (
              <FloatingCard key={group.key} style={[styles.groupCard, { backgroundColor: world.card }]}
                accessibilityLabel={`${group.artwork.name}, ${group.merchantName}, ${group.artwork.gradeName}${group.count > 1 ? `, ${group.count}개 보유` : ''}`}
                onPress={() => onOpenDetail(group.entitlementIds[0]!, group.merchantName)}>
                <View style={styles.groupImageFrame}>
                  <Image source={{ uri: group.artwork.thumbnailDataUrl }} resizeMode="contain" style={styles.groupImage} accessible={false} />
                  {group.count > 1 ? (
                    <View style={[styles.countBadge, { backgroundColor: palette.primary }]}>
                      <Text style={[styles.countBadgeText, { color: palette.onPrimary }]}>{group.count}</Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={[styles.groupName, { color: world.cardInk }]}>{group.artwork.name}</Text>
                <Text numberOfLines={1} style={[styles.groupMeta, { color: world.cardMuted }]}>{group.merchantName} · {group.artwork.gradeName}</Text>
                <Text style={[styles.groupDates, { color: world.cardMuted }]}>
                  {group.count > 1 ? `받은 날짜 ${group.earnedDates.map(earnedDateLabel).join(', ')}` : `받은 날짜 ${earnedDateLabel(group.earnedDates[0]!)}`}
                </Text>
                <View style={styles.groupActions}>
                  <Pressable accessibilityRole="button" accessibilityLabel={favorites.includes(group.key) ? '대표 진열에서 빼기' : '대표 진열에 놓기'}
                    onPress={() => onToggleFavorite(group.key)} style={[styles.groupActionButton, { borderColor: palette.primary }]}>
                    <Text style={[styles.groupActionText, { color: palette.primary }]}>{favorites.includes(group.key) ? '대표 해제' : '대표로 놓기'}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${group.artwork.name} 공유하기`} disabled={sharing}
                    onPress={() => onShare(group)} style={[styles.groupActionButton, { borderColor: palette.primary }, sharing && { opacity: 0.5 }]}>
                    <Text style={[styles.groupActionText, { color: palette.primary }]}>공유</Text>
                  </Pressable>
                </View>
                <NftStatusRow entitlements={group.entitlements} mint={mint} />
              </FloatingCard>
            ))}
            {/* 그림이 없는 옛 수집품(#296): 같은 앨범 그리드에 합쳐서 한 번만 보이게 한다. 그림이 없어 상세로 들어갈 수 없는 건
                원래 평면 목록 때와 같다(그림 있는 수집품만 CollectibleDetail을 열 수 있었다). */}
            {legacy.map((item) => (
              <LegacyCard key={item.entitlementId} item={item} mint={mint} artUrl={artUrlByMerchant.get(item.merchantId)} />
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
                {store.slots.map((slot) => (
                  <View key={slot.targetVisitCount} style={[styles.seriesSlot, { borderColor: slot.owned ? palette.primary : palette.separator, backgroundColor: slot.owned ? palette.primaryContainer : 'transparent' }]}>
                    <Text style={[styles.seriesSlotText, { color: slot.owned ? palette.onPrimaryContainer : world.cardMuted }]}>{seriesSlotText(slot)}</Text>
                  </View>
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
  const summary = nftGroupSummary(entitlements, mint.nftMinting);
  const mintable = entitlements.find((entry) => canOfferMint(entry.nftStatus, mint.nftMinting));
  const solo = entitlements.length === 1 ? entitlements[0] : undefined;
  const busy = mintable ? mint.busyEntitlementId === mintable.entitlementId : false;
  return (
    <View style={[collectionStyles.nftRow, { flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
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
      {mintable ? (
        mint.binding ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => mint.onConfirmMint(mintable.entitlementId)}
            style={[collectionStyles.mintButton, { backgroundColor: palette.primary }, busy && collectionStyles.disabled]}>
            <Text style={collectionStyles.mintButtonText}>{busy ? '접수 중…' : '양도 제한 NFT 받기'}</Text>
          </Pressable>
        ) : (
          <Link href="/wallet" asChild>
            <Pressable accessibilityRole="button" style={[collectionStyles.walletButton, { borderColor: palette.primary }]}>
              <Text style={collectionStyles.walletButtonText}>외부 지갑 주소 확인</Text>
            </Pressable>
          </Link>
        )
      ) : null}
    </View>
  );
}

/** A collectible earned without a published picture (#296): shown in the same grid, using the merchant's own art as a fallback. */
function LegacyCard({ item, mint, artUrl }: { item: UngroupedCollectible; mint: MintGate; artUrl: string | null | undefined }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const world = worldForScheme(scheme);
  const art = merchantArt({ id: item.merchantId, artUrl }, mint.apiUrl);
  const { source, onError } = useArtFallback(art?.source);
  return (
    <FloatingCard style={[styles.groupCard, { backgroundColor: world.card }]}
      accessibilityLabel={`${item.displayName}, ${item.merchantName}, ${item.targetVisitCount}회 목표`}>
      {art && source ? (
        <View style={styles.groupImageFrame}>
          <Image source={source} onError={onError} resizeMode="contain" style={styles.groupImage} accessible={false} />
        </View>
      ) : null}
      <Text numberOfLines={1} style={[styles.groupName, { color: world.cardInk }]}>{item.displayName}</Text>
      <Text numberOfLines={1} style={[styles.groupMeta, { color: world.cardMuted }]}>{item.merchantName} · {item.targetVisitCount}회</Text>
      {art ? <Text style={[styles.groupDates, { color: world.cardMuted }]}>{collectibleArtNote(art.fromServer)}</Text> : null}
      <Text style={[styles.groupDates, { color: world.cardMuted }]}>받은 날짜 {earnedDateLabel(item.earnedAt)}</Text>
      <NftStatusRow entitlements={[item]} mint={mint} />
    </FloatingCard>
  );
}

const styles = StyleSheet.create({
  empty: { padding: 18, borderRadius: 20, fontSize: 14, lineHeight: 22 },
  subtitle: { fontSize: 17, fontWeight: '800' },
  favoriteCard: { width: 108, borderRadius: 16, padding: 10, gap: 6, alignItems: 'center' },
  favoriteImage: { width: 80, height: 80 },
  favoriteName: { fontSize: 12, fontWeight: '800' },
  filterRow: { gap: 6 },
  filterLabel: { fontSize: 12, fontWeight: '800' },
  filterChip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  filterChipText: { fontSize: 12, fontWeight: '800' },
  sortRow: { flexDirection: 'row', gap: 8 },
  sortChip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sortChipText: { fontSize: 12, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  groupCard: { width: 156, borderRadius: 18, padding: 12, gap: 5 },
  groupImageFrame: { alignItems: 'center', justifyContent: 'center' },
  groupImage: { width: 104, height: 104 },
  countBadge: { position: 'absolute', top: 0, right: 8, minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  countBadgeText: { fontSize: 11, fontWeight: '900' },
  groupName: { fontSize: 14, fontWeight: '900' },
  groupMeta: { fontSize: 11 },
  groupDates: { fontSize: 10, lineHeight: 14 },
  groupActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  groupActionButton: { minHeight: 30, paddingHorizontal: 9, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  groupActionText: { fontSize: 11, fontWeight: '800' },
  seriesCard: { borderRadius: 18, padding: 14, gap: 8 },
  seriesSlots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  seriesSlot: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  seriesSlotText: { fontSize: 11, fontWeight: '800' },
  seriesNext: { fontSize: 12, fontWeight: '700' },
});
