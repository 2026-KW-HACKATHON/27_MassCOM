import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Ellipse, LinearGradient, Rect, Stop } from 'react-native-svg';

import { focusForAccessibility } from '@/accessibility/focus-component';
import { celebrationNote } from '@/commerce/progress-note';
import type { AfterVisitAction } from '@/commerce/after-visit-action';
import { useMotionEnabled } from '@/motion/use-motion';
import { tierColors } from '@/theme/medal-colors';
import { Mascot } from '@/ui/mascot';

import type { BadgeBook } from './badge-api';
import {
  celebrationStageSize,
  closestNextGoal,
  featuredRaisedMedal,
  medalTitle,
  rewardBoxName,
  type BadgeBookDiff,
  type ShareVariant,
} from './badge-rules';
import { ConfettiBurst } from './confetti';
import { FullScreenModal } from './full-screen-modal';
import { Medallion } from './medallion';
import { CloseGlyph, GiftGlyph, mascotStamp } from './glyphs';
import { successHaptic } from './native-effects';
import { useBadgeShare } from './share-card';
import { useGamificationTheme, type GamificationTheme } from './theme';
import { rewardReel, type RewardReelItem } from './reward-reel';
import type { RedeemedClaim } from '@/commerce/commerce-api';

export type CelebrationContent = {
  claimSlotId?: string;
  merchantName: string;
  progressCounted: boolean;
  progressExcludedReason?: 'STAFF_SELF';
  diff: BadgeBookDiff;
  after?: BadgeBook;
  grantedRewards?: RedeemedClaim['grantedRewards'];
  artworkRewards?: readonly { entitlementId: string; targetVisitCount: 1 | 3 | 5; name: string; gradeName: string; imageUri: string }[];
  mileageDelta?: number;
  mileageBalance?: number;
};

type Props = {
  content: CelebrationContent | undefined;
  variant: ShareVariant;
  onClose: () => void;
  primaryAction: AfterVisitAction;
  onPrimaryAction: () => void;
  onOpenFeedback?: () => void;
  /** focusRewards: a box became openable, so land on the reward section. */
  onOpenCollection: (focusRewards: boolean) => void;
  onOpenGacha?: () => void;
};

const impactAt = 420;

/** "도장 쾅!" — full-screen celebration after a confirmed visit. Static under reduced motion. */
export function Celebration({ content, variant, onClose, primaryAction, onPrimaryAction, onOpenFeedback, onOpenCollection, onOpenGacha }: Props) {
  return (
    <FullScreenModal visible={content !== undefined} animationType="fade" onRequestClose={onClose}>
        {content ? <CelebrationBody key={content.claimSlotId} content={content} variant={variant} onClose={onClose} primaryAction={primaryAction} onPrimaryAction={onPrimaryAction} onOpenFeedback={onOpenFeedback} onOpenCollection={onOpenCollection} onOpenGacha={onOpenGacha} /> : null}
      </FullScreenModal>
  );
}

function CelebrationBody({ content, variant, onClose, primaryAction, onPrimaryAction, onOpenFeedback, onOpenCollection, onOpenGacha }: Props & { content: CelebrationContent }) {
  const theme = useGamificationTheme();
  const { styles, medal } = theme;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduceMotion = !useMotionEnabled();
  const title = useRef<Text>(null);
  const { host, share, sharing } = useBadgeShare(variant);
  const [shareError, setShareError] = useState<string>();
  const [beat, setBeat] = useState(reduceMotion ? 3 : 1);
  const shownBeat = reduceMotion ? 3 : beat;
  const [stageCenterY, setStageCenterY] = useState<number>();
  const stage = celebrationStageSize(width, height);
  const featured = featuredRaisedMedal(content.diff);
  // A rank-up brings the cheering mascot; the stamp shrinks a little so the buttons stay in reach.
  const cheering = content.diff.raisedMedals.length > 0;
  const stageSize = cheering ? Math.round(stage * 0.78) : stage;
  const openable = content.diff.newlyReady.length > 0;
  const hint = content.diff.raisedMedals.length === 0 && !openable
    ? closestNextGoal(content.after)
    : null;
  const artworkById = new Map(content.artworkRewards?.map((item) => [item.entitlementId, item]));
  const items = rewardReel({
    grantedRewards: (content.grantedRewards ?? []).map((reward) => ({ ...reward, artwork: artworkById.has(reward.entitlementId) })),
    raisedMedals: content.diff.raisedMedals,
    openableBox: content.diff.newlyReady,
    mileageDelta: content.mileageDelta,
  });

  useEffect(() => {
    if (reduceMotion) return;
    const next = setTimeout(() => setBeat((current) => Math.max(2, current)), 1400);
    return () => clearTimeout(next);
  }, [reduceMotion, content.claimSlotId]);

  useEffect(() => {
    if (beat !== 2) return;
    const next = setTimeout(() => setBeat(3), Math.max(450, items.length * 180 + 350));
    return () => clearTimeout(next);
  }, [beat, items.length]);

  useEffect(() => {
    const haptic = setTimeout(() => void successHaptic(), reduceMotion ? 0 : impactAt);
    const focus = setTimeout(() => {
      if (title.current) focusForAccessibility(title.current);
    }, reduceMotion ? 250 : 900);
    return () => {
      clearTimeout(haptic);
      clearTimeout(focus);
    };
  }, [reduceMotion]);

  async function shareFeatured() {
    if (!featured) return;
    setShareError(undefined);
    if ((await share(featured)) === 'failed') setShareError('공유 창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }

  return (
    <View style={styles.fullScreen} accessibilityViewIsModal>
      <SkyBackdrop theme={theme} />
      <ScrollView
        contentContainerStyle={[styles.celebrationScroll, { paddingTop: insets.top + 52, paddingBottom: insets.bottom + 16 }]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="도장 축하 다음 보상 보기" onPress={() => setBeat((current) => Math.max(2, current))} onLayout={(event) => {
          const { y, height: stageHeight } = event.nativeEvent.layout;
          setStageCenterY(y + stageHeight / 2);
        }}>
          <StampStage theme={theme} reduceMotion={reduceMotion} size={shownBeat > 1 && !reduceMotion ? Math.round(stageSize * 0.6) : stageSize} />
        </Pressable>
        {cheering && shownBeat === 1 ? <Mascot pose="cheer" size={Math.min(140, Math.round(stage * 0.62))} /> : null}

        <Text ref={title} accessibilityRole="header" style={styles.celebrationTitle}>
          {content.merchantName} 도장 쾅!
        </Text>
        <Text accessibilityLiveRegion="polite" style={styles.celebrationBody}>
          {celebrationNote(content)}
          {hint ? `\n다음 목표 · ${hint}` : ''}
        </Text>

        {shownBeat >= 2 ? (
          <View style={{ alignSelf: 'stretch', gap: 10 }}>
            <Text accessibilityRole="header" style={[styles.celebrationTitle, { fontSize: 21 }]}>이번에 받은 것</Text>
            {items.length === 0 ? <Text style={styles.celebrationBody}>도장이 기록되었어요.</Text> : null}
            {items.map((item, index) => (
              <ReelCard key={`${item.type}-${index}`} item={item} index={index} theme={theme} reduceMotion={reduceMotion}
                artwork={item.type === 'collectible' ? artworkById.get(item.reward.entitlementId) : undefined}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.celebrationActions}>
          <Pressable
            accessibilityRole="button"
            onPress={onPrimaryAction}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Text style={styles.buttonText}>{primaryAction.label}</Text>
          </Pressable>
          {primaryAction.kind === 'recommendation' ? <Text style={styles.celebrationBody}>{primaryAction.detail}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
            <Pressable accessibilityRole="button" accessibilityLabel="도감 보기" onPress={() => onOpenCollection(false)} style={styles.ghostButton}><Text style={styles.ghostButtonText}>도감</Text></Pressable>
            <Text style={styles.celebrationBody}>·</Text>
            {onOpenGacha ? <Pressable accessibilityRole="button" accessibilityLabel="상점 뽑기" onPress={onOpenGacha} style={styles.ghostButton}><Text style={styles.ghostButtonText}>상점 뽑기</Text></Pressable> : null}
            {onOpenFeedback ? <><Text style={styles.celebrationBody}>·</Text><Pressable accessibilityRole="button" accessibilityLabel="이 가게 어땠나요? 선택" onPress={onOpenFeedback} style={styles.ghostButton}><Text style={styles.ghostButtonText}>이 가게 어땠나요?(선택)</Text></Pressable></> : null}
          </View>
          {featured ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${medalTitle(featured)} 배지 공유`}
              accessibilityState={{ busy: sharing, disabled: sharing }}
              disabled={sharing}
              onPress={() => void shareFeatured()}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, sharing && styles.disabled]}
            >
              <Text style={styles.secondaryButtonText}>{sharing ? '카드 만드는 중…' : '배지 공유'}</Text>
            </Pressable>
          ) : null}
          {shareError ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{shareError}</Text> : null}
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}>
            <Text style={styles.ghostButtonText}>닫기</Text>
          </Pressable>
        </View>
      </ScrollView>

      {!reduceMotion && stageCenterY !== undefined ? (
        <ConfettiBurst
          colors={medal.confetti}
          leafColor="#4CAF6A"
          originX={width / 2}
          originY={stageCenterY}
          width={width}
          height={height}
          count={32}
          delay={impactAt - 40}
          duration={1600}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="축하 화면 닫기"
        onPress={onClose}
        hitSlop={8}
        style={[styles.closeButton, styles.celebrationClose, { top: insets.top + 6 }]}
      >
        <CloseGlyph size={22} color={medal.skyInk} />
      </Pressable>
      {host}
    </View>
  );
}

function ReelCard({ item, index, theme, reduceMotion, artwork }: {
  item: RewardReelItem;
  index: number;
  theme: GamificationTheme;
  reduceMotion: boolean;
  artwork?: CelebrationContent['artworkRewards'] extends readonly (infer T)[] | undefined ? T : never;
}) {
  const { palette, medal } = theme;
  const scale = useSharedValue(reduceMotion ? 1 : 0.94);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const accent = useSharedValue(1);
  const accentRotation = useSharedValue(0);
  const glow = useSharedValue(0);
  const mileageAmount = item.type === 'mileage' ? item.amount : undefined;
  const [mileageShown, setMileageShown] = useState(reduceMotion && item.type === 'mileage' ? item.amount : 0);

  useEffect(() => {
    if (reduceMotion) {
      scale.set(1);
      opacity.set(1);
      accent.set(1);
      accentRotation.set(0);
      glow.set(0);
      return;
    }
    scale.set(withDelay(index * 180, withSpring(1, { duration: 400, dampingRatio: 0.72 })));
    opacity.set(withDelay(index * 180, withTiming(1, { duration: 180 })));
    if (item.type === 'medal') {
      accent.set(withDelay(index * 180 + 200, withRepeat(withSequence(withTiming(1.08, { duration: 450 }), withTiming(1, { duration: 450 })), 2)));
      glow.set(withDelay(index * 180 + 200, withRepeat(withSequence(withTiming(0.48, { duration: 450 }), withTiming(0.12, { duration: 450 })), 2)));
    }
    if (item.type === 'box') accentRotation.set(withDelay(index * 180 + 160, withSequence(
      withTiming(-8, { duration: 75 }), withTiming(8, { duration: 110 }),
      withTiming(-6, { duration: 110 }), withTiming(5, { duration: 100 }), withTiming(0, { duration: 100 }),
    )));
  }, [reduceMotion, index, item.type, scale, opacity, accent, accentRotation, glow]);

  useEffect(() => {
    if (mileageAmount === undefined || reduceMotion) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      const started = Date.now();
      const tick = setInterval(() => {
        const fraction = Math.min(1, (Date.now() - started) / 650);
        setMileageShown(Math.round(mileageAmount * fraction));
        if (fraction === 1) clearInterval(tick);
      }, 32);
      interval = tick;
    }, index * 180);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [mileageAmount, index, reduceMotion]);

  const cardStyle = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scale: scale.get() }] }));
  const accentStyle = useAnimatedStyle(() => ({ transform: [{ scale: accent.get() }, { rotate: `${accentRotation.get()}deg` }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.get(), transform: [{ scale: accent.get() * 1.2 }] }));

  return (
    <Animated.View style={[{ minHeight: 80, borderRadius: 20, padding: 14, backgroundColor: palette.surface,
      borderWidth: 2, borderColor: item.type === 'collectible'
        ? tierColors(medal, item.reward.targetVisitCount === 1 ? 1 : item.reward.targetVisitCount === 3 ? 2 : 3).base
        : palette.primaryContainer,
      flexDirection: 'row', alignItems: 'center', gap: 12 }, cardStyle]}>
      {item.type === 'collectible' ? (
        <>
          {artwork ? <Image source={{ uri: artwork.imageUri }} style={{ width: 62, height: 62, borderRadius: 12 }} /> : null}
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: palette.secondaryLabel, fontSize: 12, fontWeight: '800' }}>{artwork?.gradeName ?? `${item.reward.targetVisitCount}회 보상`}</Text>
            <Text style={{ color: palette.label, fontSize: 16, fontWeight: '900' }}>{artwork?.name ?? '새 수집품'}</Text>
          </View>
        </>
      ) : item.type === 'medal' ? (
        <>
          <Animated.View style={accentStyle}>
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 58, height: 58, borderRadius: 29,
              backgroundColor: tierColors(medal, item.raised.toTier as 1 | 2 | 3).highlight }, glowStyle]} />
            <Medallion kind={item.raised.kind} tier={item.raised.toTier} progress={null} size={58} colors={medal} arcColor={palette.primary} trackColor={palette.separator} />
          </Animated.View>
          <Text style={{ flex: 1, color: palette.label, fontSize: 16, fontWeight: '900' }}>{medalTitle(item.raised.medal)} 달성!</Text>
        </>
      ) : item.type === 'box' ? (
        <>
          <Animated.View style={accentStyle}><GiftGlyph size={45} color={medal.giftGold} ribbon={medal.ribbon} /></Animated.View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: palette.label, fontSize: 16, fontWeight: '900' }}>{rewardBoxName(item.reward.milestone)}</Text>
            <Text style={{ color: palette.secondaryLabel, fontSize: 13 }}>열 수 있어요!</Text>
          </View>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 33 }}>✦</Text>
          <Text style={{ color: palette.label, fontSize: 19, fontWeight: '900', fontVariant: ['tabular-nums'] }}>+{reduceMotion ? item.amount : mileageShown} 마일리지</Text>
        </>
      )}
    </Animated.View>
  );
}

function SkyBackdrop({ theme }: { theme: GamificationTheme }) {
  const { medal, scheme } = theme;
  const cloud = scheme === 'dark' ? 0.06 : 0.55;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="celebrationSky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={medal.sky[0]} />
          <Stop offset="0.5" stopColor={medal.sky[1]} />
          <Stop offset="1" stopColor={medal.sky[2]} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#celebrationSky)" />
      <Ellipse cx="12%" cy="14%" rx="90" ry="34" fill="#FFFFFF" opacity={cloud} />
      <Ellipse cx="88%" cy="22%" rx="110" ry="40" fill="#FFFFFF" opacity={cloud * 0.8} />
      <Ellipse cx="78%" cy="92%" rx="140" ry="46" fill="#FFFFFF" opacity={cloud * 0.7} />
    </Svg>
  );
}

function StampStage({ theme, reduceMotion, size }: { theme: GamificationTheme; reduceMotion: boolean; size: number }) {
  const { styles, palette } = theme;
  const scale = useSharedValue(reduceMotion ? 1 : 2.3);
  const rotate = useSharedValue(reduceMotion ? -8 : -28);
  const lift = useSharedValue(reduceMotion ? 0 : -46);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const blot = useSharedValue(reduceMotion ? 1 : 0);
  const ring = useSharedValue(0);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    const spring = { damping: 11, stiffness: 210, mass: 0.9 };
    opacity.set(withDelay(180, withTiming(1, { duration: 110 })));
    scale.set(withDelay(180, withSpring(1, spring)));
    rotate.set(withDelay(180, withSpring(-8, spring)));
    lift.set(withDelay(180, withSpring(0, spring)));
    blot.set(withDelay(impactAt - 20, withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) })));
    ring.set(withDelay(impactAt - 20, withTiming(1, { duration: 950, easing: Easing.out(Easing.quad) })));
    shake.set(withDelay(impactAt - 20, withSequence(
      withTiming(6, { duration: 45 }),
      withTiming(-5, { duration: 70 }),
      withTiming(3, { duration: 60 }),
      withTiming(0, { duration: 60 }),
    )));
  }, [reduceMotion, opacity, scale, rotate, lift, blot, ring, shake]);

  const stageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));
  const stampStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateY: lift.get() }, { scale: scale.get() }, { rotate: `${rotate.get()}deg` }],
  }));
  const blotStyle = useAnimatedStyle(() => ({
    opacity: 0.18 * blot.get(),
    transform: [{ scale: 0.55 + blot.get() * 0.6 }],
  }));

  const paper = Math.round(size * 0.84);
  const ink = Math.round(size * 0.78);
  const stamp = Math.round(size * 0.68);
  return (
    <Animated.View
      style={[styles.stage, { width: size, height: size }, stageStyle]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {/* Ink-pad paper: tinted so the gap around the stamp reads as ink, not a hole. */}
      <View style={[styles.stagePaper, { width: paper, height: paper, borderRadius: paper / 2, backgroundColor: palette.primaryContainer }]} />
      <Animated.View style={[styles.inkBlot, { width: ink, height: ink, borderRadius: ink / 2 }, blotStyle]} />
      {reduceMotion ? null : (
        <>
          <InkRing progress={ring} delay={0} theme={theme} size={ink} />
          <InkRing progress={ring} delay={0.18} theme={theme} size={ink} />
        </>
      )}
      <Animated.View style={stampStyle}>
        <Image source={mascotStamp} style={{ width: stamp, height: stamp, borderRadius: stamp / 2 }} />
      </Animated.View>
    </Animated.View>
  );
}

function InkRing({ progress, delay, theme, size }: { progress: SharedValue<number>; delay: number; theme: GamificationTheme; size: number }) {
  const style = useAnimatedStyle(() => {
    const local = Math.min(1, Math.max(0, (progress.get() - delay) / (1 - delay)));
    return {
      opacity: local === 0 || local === 1 ? 0 : 0.55 * (1 - local),
      transform: [{ scale: 0.85 + local * 0.75 }],
    };
  });
  return <Animated.View style={[theme.styles.inkRing, { width: size, height: size, borderRadius: size / 2 }, style]} />;
}
