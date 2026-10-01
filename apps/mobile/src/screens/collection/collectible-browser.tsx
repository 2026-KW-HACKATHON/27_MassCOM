import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { collectibleFilterOptions, filterCollectibleGroups, sortCollectibleGroups, type CollectibleFilter, type CollectibleSort } from './collectible-filters';
import type { CollectibleGroup } from './collectible-groups';
import { seriesSlotText, type StoreSeries } from './store-series';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { FloatingCard } from '@/ui/floating-card';

const sortOptions: readonly { value: CollectibleSort; label: string }[] = [
  { value: 'recent', label: '최신순' },
  { value: 'store', label: '가게순' },
  { value: 'grade', label: '등급순' },
];

function earnedDateLabel(iso: string): string {
  return iso.slice(0, 10);
}

export function CollectibleBrowser({ groups, favorites, series, sharing, onToggleFavorite, onOpenDetail, onShare }: {
  groups: readonly CollectibleGroup[];
  favorites: readonly string[];
  series: readonly StoreSeries[];
  sharing: boolean;
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

  if (groups.length === 0 && series.length === 0) {
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

      {groups.length > 0 ? (
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
              </FloatingCard>
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
