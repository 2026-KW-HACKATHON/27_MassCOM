import { Pressable, Text, View } from 'react-native';

import { tierColors } from '@/theme/medal-colors';

import type { Medal, MedalKind } from './badge-api';
import { medalAccessibilityLabel, medalCopy, medalProgressLines, medalProgressText, nextTierProgress, tierName } from './badge-rules';
import { Medallion, medallionSizes } from './medallion';
import { useGamificationTheme } from './theme';

/** ② 배지: three medals; tap for the tier table and sharing. */
export function MedalShelf({ medals, stacked, onSelect }: {
  medals: readonly Medal[];
  stacked: boolean;
  onSelect: (kind: MedalKind) => void;
}) {
  const { styles } = useGamificationTheme();
  return (
    <View style={[styles.shelf, stacked && styles.shelfStacked]}>
      {medals.map((medal) => (
        <MedalCard key={medal.kind} medal={medal} stacked={stacked} onPress={() => onSelect(medal.kind)} />
      ))}
    </View>
  );
}

function MedalCard({ medal, stacked, onPress }: { medal: Medal; stacked: boolean; onPress: () => void }) {
  const { styles, palette, medal: colors } = useGamificationTheme();
  const progress = nextTierProgress(medal);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={medalAccessibilityLabel(medal)}
      accessibilityHint="등급표와 공유를 열어요."
      onPress={onPress}
      style={({ pressed }) => [styles.medalCard, stacked && styles.medalCardStacked, pressed && styles.pressed]}
    >
      <Medallion
        kind={medal.kind}
        tier={medal.tier}
        progress={progress.fraction}
        size={stacked ? medallionSizes.row : medallionSizes.grid}
        colors={colors}
        arcColor={palette.primary}
        trackColor={palette.separator}
        animateArc
      />
      <View style={[styles.medalCardCopy, stacked && styles.medalCardCopyStacked]}>
        <Text style={[styles.medalName, stacked && styles.medalNameStacked]}>{medalCopy(medal.kind).name}</Text>
        <TierChip tier={medal.tier} />
        <Text style={[styles.medalProgress, stacked && styles.medalProgressStacked]}>
          {stacked ? medalProgressText(medal) : medalProgressLines(medal).join('\n')}
        </Text>
      </View>
    </Pressable>
  );
}

export function TierChip({ tier }: { tier: Medal['tier'] }) {
  const { styles, palette, medal } = useGamificationTheme();
  const colors = tier > 0 ? tierColors(medal, tier as 1 | 2 | 3) : null;
  return (
    <View style={[styles.chip, { alignSelf: 'auto', backgroundColor: colors ? colors.container : palette.background, borderWidth: colors ? 0 : 1, borderColor: palette.separator }]}>
      <Text style={[styles.chipText, { color: colors ? colors.onContainer : palette.secondaryLabel }]}>
        {tier > 0 ? tierName(tier) : '도전 전'}
      </Text>
    </View>
  );
}

export function MedalShelfSkeleton({ stacked }: { stacked: boolean }) {
  const { styles } = useGamificationTheme();
  return (
    <View accessible accessibilityLabel="배지를 불러오는 중" style={[styles.shelf, stacked && styles.shelfStacked]}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={[styles.shelfSkeleton, stacked && { height: 96 }]} />
      ))}
    </View>
  );
}

export function SectionRetry({ message, onRetry, busy }: { message: string; onRetry: () => void; busy: boolean }) {
  const { styles } = useGamificationTheme();
  return (
    <View style={styles.retryCard}>
      <Text accessibilityLiveRegion="polite" style={styles.retryText}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onRetry}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, busy && styles.disabled]}
      >
        <Text style={styles.secondaryButtonText}>{busy ? '불러오는 중…' : '다시 불러오기'}</Text>
      </Pressable>
    </View>
  );
}
