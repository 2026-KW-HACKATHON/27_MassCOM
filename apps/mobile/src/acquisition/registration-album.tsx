import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { lightHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { playUiSound } from '@/sound/ui-sounds';
import { colorsForScheme } from '@/theme/palette';
import { withAlpha } from '@/theme/contrast';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';
import { BounceButton } from '@/ui/bounce-button';

import { buildRegistrationPlan, type RegistrationPlanItem, type RegistrationSlot } from './registration-plan';

export type RegistrationItem = RegistrationPlanItem & {
  artwork: ReactNode;
};

export type RegistrationAlbumProps = {
  receiptId: string;
  sourceLabel: string;
  items: RegistrationItem[];
  onDone: () => void;
  onOpenCollection?: () => void;
  collectionLabel?: string;
};

const SLOT_DELAY_MS = 150;
const STAMP_DELAY_MS = 240;

export function RegistrationAlbum({
  receiptId,
  sourceLabel,
  items,
  onDone,
  onOpenCollection,
  collectionLabel = '도감에서 보기',
}: RegistrationAlbumProps) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const styles = useMemo(() => makeStyles(palette, world), [palette, world]);
  const plan = useMemo(() => buildRegistrationPlan(items), [items]);
  const [settledReceiptId, setSettledReceiptId] = useState<string | null>(null);
  const { width, fontScale } = useWindowDimensions();
  const compact = shouldUseCompactAlbum(width, fontScale);
  const settleAll = settledReceiptId === receiptId;

  const skip = () => {
    setSettledReceiptId(receiptId);
    void lightHaptic();
    playUiSound('tap');
  };

  return (
    <View
      style={styles.frame}
      accessibilityLabel={`${sourceLabel} 보상 도감 등록 확인`}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.heading}>
        <View style={styles.receiptPill}>
          <Text style={styles.receiptText} maxFontSizeMultiplier={1.8}>{sourceLabel}</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.6}>
          도감 등록 확인
        </Text>
        <Text style={styles.summary} maxFontSizeMultiplier={2}>
          {plan.summary}
        </Text>
      </View>

      <View style={[styles.albumGrid, compact ? styles.albumGridCompact : null]}>
        {plan.slots.map((slot, index) => (
          <RegistrationAlbumSlot
            key={`${receiptId}:${slot.id}:${index}`}
            slot={slot}
            artwork={items[index]?.artwork}
            settleAll={settleAll}
            compact={compact}
          />
        ))}
      </View>

      <View style={styles.truthNote}>
        <Text style={styles.truthText} maxFontSizeMultiplier={2}>
          {plan.duplicateOrOwnedCount > 0
            ? '이미 갖고 있던 보상도 이번 결과에 포함돼 있어요.'
            : '이번에 얻은 수집품은 도감이나 내 공간에서 다시 볼 수 있어요.'}
        </Text>
      </View>

      <View style={styles.actions}>
        <SettleButton onPress={skip} />
        {onOpenCollection ? <View style={styles.actionGrow}><BounceButton label={collectionLabel} variant="secondary" onPress={onOpenCollection} /></View> : null}
        <View style={styles.actionGrow}><BounceButton label="확인 완료" onPress={onDone} /></View>
      </View>
    </View>
  );
}

function RegistrationAlbumSlot({ slot, artwork, settleAll, compact = false }: {
  slot: RegistrationSlot;
  artwork: ReactNode;
  settleAll: boolean;
  compact?: boolean;
}) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const styles = useMemo(() => makeStyles(palette, world), [palette, world]);
  const motionEnabled = useMotionEnabled();
  const scale = useSharedValue(slot.isNew && motionEnabled && !settleAll ? 0.64 : 1);
  const opacity = useSharedValue(slot.isNew && motionEnabled && !settleAll ? 0 : 1);
  const stampScale = useSharedValue(slot.isNew && motionEnabled && !settleAll ? 1.45 : 1);
  const stampOpacity = useSharedValue(slot.isNew ? (motionEnabled && !settleAll ? 0 : 1) : 1);
  const playedKey = useRef<string | null>(null);
  const animationKey = `${slot.id}:${slot.sequenceIndex ?? 'stable'}`;

  useEffect(() => {
    if (!slot.isNew || !motionEnabled || settleAll) {
      playedKey.current = animationKey;
      cancelAnimation(scale);
      cancelAnimation(opacity);
      cancelAnimation(stampScale);
      cancelAnimation(stampOpacity);
      scale.set(1);
      opacity.set(1);
      stampScale.set(1);
      stampOpacity.set(1);
      return undefined;
    }
    if (playedKey.current === animationKey) {
      scale.set(1);
      opacity.set(1);
      stampScale.set(1);
      stampOpacity.set(1);
      return undefined;
    }
    playedKey.current = animationKey;
    const delay = Math.max(0, slot.sequenceIndex ?? 0) * SLOT_DELAY_MS;
    scale.set(0.64);
    opacity.set(0);
    stampScale.set(1.45);
    stampOpacity.set(0);
    opacity.set(withDelay(delay, withTiming(1, { duration: 120, easing: Easing.out(Easing.cubic) })));
    scale.set(withDelay(delay, withSequence(
      withTiming(1.12, { duration: 180, easing: Easing.out(Easing.cubic) }),
      withSpring(1, { damping: 11, stiffness: 190 }),
    )));
    stampOpacity.set(withDelay(delay + STAMP_DELAY_MS, withTiming(1, { duration: 90 })));
    stampScale.set(withDelay(delay + STAMP_DELAY_MS, withSpring(1, { damping: 9, stiffness: 210 })));
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
      cancelAnimation(stampScale);
      cancelAnimation(stampOpacity);
    };
  }, [animationKey, motionEnabled, opacity, scale, settleAll, slot.isNew, slot.sequenceIndex, stampOpacity, stampScale]);

  const slotStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const stampStyle = useAnimatedStyle(() => ({
    opacity: stampOpacity.value,
    transform: [{ scale: stampScale.value }, { rotate: '-7deg' }],
  }));

  return (
    <Animated.View
      style={[styles.slot, compact ? styles.compactSlot : null, slot.isNew ? styles.newSlot : styles.confirmSlot, slotStyle]}
      accessibilityRole="summary"
      accessibilityLabel={`${slot.name}, ${slot.kindLabel}, ${slot.statusLabel}. ${slot.confirmation}`}
    >
      <View style={styles.artworkFrame} importantForAccessibility="no-hide-descendants">
        {artwork}
      </View>
      <View style={styles.slotText}>
        <Text style={styles.itemName} maxFontSizeMultiplier={1.7}>{slot.name}</Text>
        <Text style={styles.kindLabel} maxFontSizeMultiplier={1.8}>{slot.kindLabel}</Text>
        <Text style={styles.confirmation} maxFontSizeMultiplier={2}>{slot.confirmation}</Text>
      </View>
      <Animated.View style={[styles.stamp, slot.isNew ? styles.newStamp : styles.ownedStamp, stampStyle]}>
        <Text style={[styles.stampText, slot.isNew ? styles.newStampText : styles.ownedStampText]} maxFontSizeMultiplier={1.4}>
          {slot.isNew ? '등록' : '확인'}
        </Text>
        <Text style={[styles.checkText, slot.isNew ? styles.newStampText : styles.ownedStampText]} maxFontSizeMultiplier={1.4}>
          ✓
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

export function shouldUseCompactAlbum(width: number, fontScale: number | undefined): boolean {
  return width <= 340 || (fontScale ?? 1) > 1.3;
}

function SettleButton({ onPress }: { onPress: () => void }) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const styles = useMemo(() => makeStyles(palette, world), [palette, world]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="연출 건너뛰기"
      accessibilityHint="등록 확인 화면은 닫지 않고 모든 항목을 완성 상태로 보여 줍니다."
      onPress={onPress}
      style={({ pressed }) => [styles.skipButton, pressed ? styles.skipButtonPressed : null]}
    >
      <Text style={styles.skipText} maxFontSizeMultiplier={1.6}>연출 건너뛰기</Text>
    </Pressable>
  );
}

function makeStyles(
  palette: ReturnType<typeof colorsForScheme>,
  world: ReturnType<typeof worldForScheme>,
): Record<string, ImageStyle | TextStyle | ViewStyle> {
  return {
    frame: {
      gap: 16,
      padding: uiMetrics.pageInset,
      borderRadius: world.radius.card,
      backgroundColor: world.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withAlpha(world.paperLine, 0.35),
    },
    heading: { gap: 8 },
    receiptPill: {
      alignSelf: 'flex-start',
      minHeight: 32,
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderRadius: world.radius.chip,
      backgroundColor: palette.primaryContainer,
    },
    receiptText: { color: palette.onPrimaryContainer, fontSize: 13, fontWeight: '800' },
    title: { color: world.cardInk, fontSize: 24, fontWeight: '900', letterSpacing: 0 },
    summary: { color: world.cardMuted, fontSize: 15, lineHeight: 22, fontWeight: '700' },
    albumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    albumGridCompact: { flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'stretch' },
    compactSlot: { flexBasis: 'auto', flexGrow: 0, width: '100%' },
    slot: {
      flexGrow: 1,
      flexBasis: 148,
      minWidth: 0,
      position: 'relative' as const,
      gap: 10,
      padding: 12,
      borderRadius: 18,
      borderWidth: 1,
    },
    newSlot: {
      backgroundColor: world.paper,
      borderColor: world.paperLine,
      shadowColor: world.cardShadow,
      shadowOpacity: 0.13,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    confirmSlot: {
      backgroundColor: withAlpha(world.cardInk, 0.05),
      borderColor: withAlpha(world.cardInk, 0.16),
    },
    artworkFrame: {
      minHeight: 86,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden' as const,
      backgroundColor: withAlpha(world.paperLine, 0.12),
    },
    slotText: { gap: 4 },
    itemName: { color: world.cardInk, fontSize: 16, lineHeight: 21, fontWeight: '900' },
    kindLabel: { color: world.cardMuted, fontSize: 13, lineHeight: 18, fontWeight: '800' },
    confirmation: { color: world.cardMuted, fontSize: 13, lineHeight: 19, fontWeight: '600' },
    stamp: {
      position: 'absolute' as const,
      top: 10,
      right: 10,
      minWidth: 48,
      minHeight: 48,
      borderRadius: 999,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    newStamp: { borderColor: world.stampInk, backgroundColor: withAlpha(world.stampOrange, 0.16) },
    ownedStamp: { borderColor: palette.primary, backgroundColor: withAlpha(palette.primary, 0.1) },
    stampText: { fontSize: 12, lineHeight: 14, fontWeight: '900' },
    checkText: { fontSize: 14, lineHeight: 15, fontWeight: '900' },
    newStampText: { color: world.stampInk },
    ownedStampText: { color: palette.primary },
    truthNote: {
      padding: 12,
      borderRadius: 14,
      backgroundColor: withAlpha(palette.primary, 0.08),
    },
    truthText: { color: world.cardMuted, fontSize: 13, lineHeight: 19, fontWeight: '700' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 10 },
    actionGrow: { flexGrow: 1, minWidth: 132 },
    skipButton: {
      minHeight: uiMetrics.minTouch,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: withAlpha(world.cardInk, 0.18),
      backgroundColor: withAlpha(world.cardInk, 0.05),
    },
    skipButtonPressed: { backgroundColor: withAlpha(world.cardInk, 0.12) },
    skipText: { color: world.cardInk, fontSize: 14, fontWeight: '900', textAlign: 'center' as const },
  };
}
