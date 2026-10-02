import { Pressable, ScrollView, Text } from 'react-native';

import type { ProgressFilter } from '@/merchant/apply-merchant-filters';
import type { MerchantCategory } from '@/merchant/merchant-categories';

import { progressChipLabel } from './discovery-filters';
import { useMerchantListStyles } from './use-merchant-list-styles';

type Styles = ReturnType<typeof useMerchantListStyles>;

type Props = {
  /** Only categories present in the loaded list (categoryChipOptions); the row is not drawn when this is empty. */
  categories: readonly MerchantCategory[];
  category: MerchantCategory | null;
  onCategory: (category: MerchantCategory | null) => void;
  /** Only chips whose data has loaded for a signed-in account (progressChipOptions); the row is not drawn when this is empty. */
  progressOptions: readonly ProgressFilter[];
  progress: ProgressFilter | null;
  onProgress: (progress: ProgressFilter) => void;
};

/**
 * 탐색 목록의 필터 칩 두 줄(Issue #331): 업종("전체" + 목록에 있는 업종)과 내 진행 상태. 칩은 버튼이고 고른 칩은
 * accessibilityState.selected로 알리며, 색뿐 아니라 ✓ 표시로도 구분한다. 터치 영역은 48dp 이상이다.
 */
export function DiscoveryChips({ categories, category, onCategory, progressOptions, progress, onProgress }: Props) {
  const styles = useMerchantListStyles();
  return (
    <>
      {categories.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.discoveryChipScroll} contentContainerStyle={styles.discoveryChipRow}>
          <Chip styles={styles} label="전체" accessibilityLabel="업종 전체" selected={category === null} onPress={() => onCategory(null)} />
          {categories.map((value) => (
            <Chip key={value} styles={styles} label={value} accessibilityLabel={`업종 ${value}`} selected={category === value} onPress={() => onCategory(value)} />
          ))}
        </ScrollView>
      ) : null}
      {progressOptions.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.discoveryChipScroll} contentContainerStyle={styles.discoveryChipRow}>
          {progressOptions.map((value) => (
            <Chip key={value} styles={styles} label={progressChipLabel(value)} accessibilityLabel={progressChipLabel(value)} selected={progress === value} onPress={() => onProgress(value)} />
          ))}
        </ScrollView>
      ) : null}
    </>
  );
}

function Chip({ styles, label, accessibilityLabel, selected, onPress }: {
  styles: Styles;
  label: string;
  accessibilityLabel: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.discoveryChip, selected ? styles.discoveryChipSelected : null]}
    >
      <Text style={[styles.discoveryChipText, selected ? styles.discoveryChipTextSelected : null]}>{selected ? `✓ ${label}` : label}</Text>
    </Pressable>
  );
}
