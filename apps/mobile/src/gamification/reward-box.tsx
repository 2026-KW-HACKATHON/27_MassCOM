import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { AppColors } from '@/theme/palette';
import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';
import { playUiSound } from '@/sound/ui-sounds';

import { BadgeApiError, type OpenedReward, type Reward, type RewardMilestone } from './badge-api';
import { openRewardErrorMessage, rewardAccessibilityLabel, rewardBoxName, rewardStatusText } from './badge-rules';
import { GiftBox, type GiftBoxHandle, type GiftBoxMood } from './gift-box';
import { lightHaptic } from './native-effects';
import { useGamificationTheme } from './theme';

type Props = {
  reward: Reward;
  earnedTiers: number;
  /** Calls the API only; the caller updates the badge book in onRevealed after the lid pops. */
  onOpen: (milestone: RewardMilestone) => Promise<OpenedReward>;
  onRevealed: (result: OpenedReward) => void;
  onOpenFailed?: (code: string | undefined) => void;
};

const moods: Record<Reward['state'], GiftBoxMood> = {
  LOCKED: 'locked',
  READY: 'ready',
  UNAVAILABLE: 'unavailable',
  OPENED: 'opened',
};

export function RewardBoxCard({ reward, earnedTiers, onOpen, onRevealed, onOpenFailed }: Props) {
  const { styles, medal, palette } = useGamificationTheme();
  const reduceMotion = useReducedMotion();
  const box = useRef<GiftBoxHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [openApi, setOpenApi] = useState(() => onOpen);
  const request = useRef(0);
  if (openApi !== onOpen) {
    setOpenApi(() => onOpen);
    setBusy(false);
    setError(undefined);
  }
  useLayoutEffect(() => {
    request.current += 1;
    return () => { request.current += 1; };
  }, [openApi]);
  const ready = reward.state === 'READY';
  const offerLine = reward.offer && (reward.state === 'LOCKED' || reward.state === 'READY')
    ? `${publicDataDemoStoreName(reward.offer.merchantId, reward.offer.merchantName)} · ${reward.offer.title}`
    : null;

  async function openBox() {
    if (busy) return;
    const opening = ++request.current;
    const isCurrent = () => opening === request.current;
    setBusy(true);
    playUiSound('open');
    setError(undefined);
    box.current?.shake();
    void lightHaptic();
    try {
      // Let the wobble read even on a fast network.
      const [result] = await Promise.all([onOpen(reward.milestone), wait(reduceMotion ? 0 : 750)]);
      if (!isCurrent()) return;
      await box.current?.pop();
      if (!isCurrent()) return;
      onRevealed(result);
    } catch (caught) {
      if (!isCurrent()) return;
      box.current?.settle();
      // 여는 소리를 이미 냈으니 실패도 소리로 알린다(방문 수령 실패와 같은 신호).
      playUiSound('error');
      const code = caught instanceof BadgeApiError ? caught.code : undefined;
      setError(openRewardErrorMessage(code));
      onOpenFailed?.(code);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  const chip = stateChip(reward.state, palette);
  return (
    <View style={[styles.boxRowCard, ready && styles.boxRowCardReady]}>
      <GiftBox ref={box} milestone={reward.milestone} mood={moods[reward.state]} size={64} colors={medal} glowColor={palette.primary} />
      <View style={styles.boxRowBody}>
        <View accessible accessibilityLabel={`${rewardAccessibilityLabel(reward, earnedTiers)}${offerLine ? `, ${offerLine}` : ''}`} style={styles.boxRowCopy}>
          {/* One Text node: a row of two bold Texts was measured narrower than drawn on Samsung phones and clipped "황금 상자" to "황금". */}
          <Text textBreakStrategy="simple" style={styles.boxName}>
            {rewardBoxName(reward.milestone)}
            <Text style={styles.boxRequirement}>{`  배지 ${reward.requiredTiers}개`}</Text>
          </Text>
          <View style={[styles.chip, { backgroundColor: chip.background }]}>
            <Text style={[styles.chipText, { color: chip.foreground }]}>{rewardStatusText(reward, earnedTiers)}</Text>
          </View>
          {offerLine ? <Text style={styles.boxOffer}>{offerLine}</Text> : null}
        </View>
        {ready ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${rewardBoxName(reward.milestone)} 열기`}
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={() => void openBox()}
            style={({ pressed }) => [styles.boxButton, pressed && styles.pressed, busy && styles.disabled]}
          >
            <Text style={styles.boxButtonText}>{busy ? '여는 중…' : '상자 열기'}</Text>
          </Pressable>
        ) : null}
        {error ? <Text accessibilityLiveRegion="polite" style={styles.boxError}>{error}</Text> : null}
      </View>
    </View>
  );
}

function stateChip(state: Reward['state'], palette: AppColors): { background: string; foreground: string } {
  switch (state) {
    case 'READY': return { background: palette.primary, foreground: palette.onPrimary };
    case 'OPENED': return { background: palette.successContainer, foreground: palette.onSuccessContainer };
    case 'UNAVAILABLE': return { background: palette.accentContainer, foreground: palette.onAccentContainer };
    case 'LOCKED': return { background: palette.surface, foreground: palette.secondaryLabel };
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
