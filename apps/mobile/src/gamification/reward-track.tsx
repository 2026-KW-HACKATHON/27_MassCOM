import { Text, View } from 'react-native';

import type { BadgeBook, OpenedReward, RewardMilestone } from './badge-api';
import { badgesToNextBox } from './badge-rules';
import { RewardBoxCard } from './reward-box';
import { useGamificationTheme } from './theme';

const maxTiers = 9;

type Props = {
  book: BadgeBook;
  onOpen: (milestone: RewardMilestone) => Promise<OpenedReward>;
  onRevealed: (result: OpenedReward) => void;
  onOpenFailed?: (code: string | undefined) => void;
};

/** Badge progress rail (0–9) with 3·6·9 markers, then one full-width row per gift box. */
export function RewardTrack({ book, onOpen, onRevealed, onOpenFailed }: Props) {
  const { styles, palette } = useGamificationTheme();
  const toNext = badgesToNextBox(book);
  const earned = Math.min(maxTiers, book.earnedTiers);
  const summary = toNext === null ? '모든 상자에 닿았어요' : `다음 상자까지 배지 ${toNext}개`;

  return (
    <View style={styles.trackPanel}>
      <View style={styles.trackHeader}>
        <Text style={styles.trackLabel}>
          모은 배지 <Text style={styles.trackValue}>{earned}/{maxTiers}</Text>
        </Text>
        <Text style={styles.trackSummary}>{summary}</Text>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="보상 상자 진행"
        accessibilityValue={{ min: 0, max: maxTiers, now: earned, text: `배지 ${earned}개 모음, ${summary}` }}
        style={styles.rail}
      >
        <View style={styles.railTrack}>
          <View style={[styles.railFill, { width: `${(earned / maxTiers) * 100}%` }]} />
        </View>
        {book.rewards.map((reward) => {
          const reached = earned >= reward.requiredTiers;
          return (
            <View
              key={reward.milestone}
              style={[
                styles.railMarker,
                {
                  left: `${Math.min(100, (reward.requiredTiers / maxTiers) * 100)}%`,
                  marginLeft: reward.requiredTiers >= maxTiers ? -12 : -6,
                  borderColor: palette.primary,
                  backgroundColor: reached ? palette.primary : palette.background,
                },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.boxList}>
        {book.rewards.map((reward) => (
          <RewardBoxCard
            key={reward.milestone}
            reward={reward}
            earnedTiers={book.earnedTiers}
            onOpen={onOpen}
            onRevealed={onRevealed}
            onOpenFailed={onOpenFailed}
          />
        ))}
      </View>
    </View>
  );
}
