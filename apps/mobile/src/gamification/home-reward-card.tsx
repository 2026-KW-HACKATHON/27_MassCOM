import { Text, View } from 'react-native';

import type { BadgeBook, OpenedReward, RewardMilestone } from './badge-api';
import { badgesToNextBox, homeFeaturedReward } from './badge-rules';
import { RewardBoxCard } from './reward-box';
import { useGamificationTheme } from './theme';

const maxTiers = 9;

type Props = {
  book: BadgeBook;
  onOpen: (milestone: RewardMilestone) => Promise<OpenedReward>;
  onRevealed: (result: OpenedReward) => void;
  onOpenFailed?: (code: string | undefined) => void;
};

/**
 * 탐색(홈) 화면의 보상 상자 요약 카드(#296, Option A): 모은 배지와 다음 상자까지 남은 배지 수를 한 줄로 보여주고,
 * 지금 열 수 있는 상자(없으면 다음 목표 상자)를 바로 열 수 있게 한다. `RewardTrack`과 같은 패널 스타일·같은 열기
 * 흐름(RewardBoxCard)을 그대로 재사용해, 도감의 전체 진행 막대 없이도 한눈에 보이는 압축판이다.
 */
export function HomeRewardCard({ book, onOpen, onRevealed, onOpenFailed }: Props) {
  const { styles } = useGamificationTheme();
  const reward = homeFeaturedReward(book);
  if (!reward) return null;
  const earned = Math.min(maxTiers, book.earnedTiers);
  const toNext = badgesToNextBox(book);
  const summary = toNext === null ? '모든 상자에 닿았어요' : `다음 상자까지 배지 ${toNext}개`;

  return (
    <View style={styles.trackPanel}>
      <View style={styles.trackHeader}>
        <Text style={styles.trackLabel}>
          모은 배지 <Text style={styles.trackValue}>{earned}/{maxTiers}</Text>
        </Text>
        <Text style={styles.trackSummary}>{summary}</Text>
      </View>
      <RewardBoxCard reward={reward} earnedTiers={book.earnedTiers} onOpen={onOpen} onRevealed={onRevealed} onOpenFailed={onOpenFailed} />
    </View>
  );
}
