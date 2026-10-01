import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { FullScreenModal } from '@/gamification/full-screen-modal';
import { lightHaptic, successHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';

import type { ShopRerollResult } from '@/shop/shop-api';
import { friendArt, ticketArt } from '@/shop/shop-art';

const SHAKE_MS = 420;

type Props = {
  result: ShopRerollResult;
  /** The drawn character is already the account's representative (rare: a replayed retry after setting it). */
  isAvatar: boolean;
  avatarBusy: boolean;
  /** A failed "대표로 설정" attempt: shown here, not as a notice behind this full-screen modal (PR #312 리뷰 7번). */
  avatarError?: string;
  onSetAvatar: () => void;
  onClose: () => void;
};

/**
 * 재뽑기권 뽑기 연출(design-298.md Android "Draw animation"): 티켓이 흔들리다 열리고 카드가 뒤집혀 캐릭터를 보여준다.
 * 카드 뒤집기는 #297 봉투 카드(envelope-card.tsx)와 같은 rotateY 기법을 쓰지만, 그림이 정적 asset이고 홀로그램
 * 스윕이 필요 없어 이 화면만을 위한 작은 버전으로 다시 쓴다. reduce-motion이면 흔들기 단계 없이 바로 열린 상태로
 * 시작한다.
 */
export function DrawReveal({ result, isAvatar, avatarBusy, avatarError, onSetAvatar, onClose }: Props) {
  const motionAllowed = useMotionEnabled();
  const [stage, setStage] = useState<'shaking' | 'open'>(motionAllowed ? 'shaking' : 'open');
  const shake = useSharedValue(0);
  const flip = useSharedValue(motionAllowed ? 0 : 1);

  useEffect(() => {
    if (!motionAllowed) return;
    void lightHaptic();
    shake.set(withSequence(
      withTiming(-6, { duration: 70 }), withTiming(6, { duration: 90 }),
      withTiming(-5, { duration: 80 }), withTiming(5, { duration: 70 }), withTiming(0, { duration: 70 }),
    ));
    const timer = setTimeout(() => {
      setStage('open');
      flip.set(withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
      void successHaptic();
    }, SHAKE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount (the caller remounts this for each draw).
  }, []);

  const ticketStyle = useAnimatedStyle(() => ({
    opacity: stage === 'shaking' ? 1 : 0,
    transform: [{ rotate: `${shake.get()}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(flip.get(), [0, 1], [0, 180])}deg` }],
    opacity: stage === 'open' && flip.get() < 0.5 ? 1 : 0,
  }));
  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${interpolate(flip.get(), [0, 1], [-180, 0])}deg` }],
    opacity: stage === 'open' && flip.get() >= 0.5 ? 1 : 0,
  }));

  const avatarLabel = isAvatar ? '대표 캐릭터예요' : avatarBusy ? '설정 중…' : '대표로 설정';

  return (
    <FullScreenModal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable accessibilityRole="button" accessibilityLabel="연출 건너뛰기" onPress={() => { setStage('open'); flip.set(1); }} style={styles.skipButton}>
          <Text style={styles.skipButtonText}>건너뛰기</Text>
        </Pressable>

        <View style={styles.stage}>
          {stage === 'shaking' ? (
            <Animated.View style={ticketStyle}>
              <Image source={ticketArt[result.item.grade]} resizeMode="contain" style={styles.ticket} accessibilityIgnoresInvertColors accessible={false} />
            </Animated.View>
          ) : (
            <View style={styles.cardWrap}>
              <Animated.View style={[StyleSheet.absoluteFill, styles.face, styles.back, backStyle]}>
                <Text style={styles.backMark}>?</Text>
              </Animated.View>
              <Animated.View style={[StyleSheet.absoluteFill, styles.face, styles.front, frontStyle]}>
                <Image source={friendArt[result.item.id]} resizeMode="contain" style={styles.art} accessibilityIgnoresInvertColors accessible={false} />
                <View style={styles.newBadge} accessibilityLabel="새로 뽑은 친구">
                  <Text style={styles.newBadgeText}>NEW</Text>
                </View>
                <Text accessibilityRole="header" style={styles.name}>{result.item.name}</Text>
              </Animated.View>
            </View>
          )}
          <Text accessibilityLiveRegion="polite" style={styles.srOnly}>
            {stage === 'open' ? `${result.item.name}를 뽑았어요` : '뽑는 중'}
          </Text>
        </View>

        {stage === 'open' ? (
          <>
            {avatarError ? <Text accessibilityLiveRegion="polite" style={styles.avatarErrorText}>{avatarError}</Text> : null}
            <View style={styles.actions}>
              <Control label={avatarLabel} primary disabled={isAvatar || avatarBusy} onPress={onSetAvatar} />
              <Control label="닫기" onPress={onClose} />
            </View>
          </>
        ) : null}
      </View>
    </FullScreenModal>
  );
}

function Control({ label, onPress, primary = false, disabled = false }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.control, primary && styles.controlPrimary, disabled && styles.controlDisabled]}
    >
      <Text style={[styles.controlText, primary && styles.controlTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#14213A', paddingHorizontal: 24, gap: 16, alignItems: 'stretch', justifyContent: 'center' },
  skipButton: { position: 'absolute', top: 24, right: 16, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  skipButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  stage: { alignItems: 'center', justifyContent: 'center', minHeight: 300 },
  ticket: { width: 180, height: 180 },
  cardWrap: { width: 240, height: 300 },
  face: { borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backfaceVisibility: 'hidden' },
  back: { backgroundColor: '#1D2E52' },
  backMark: { color: 'rgba(255,255,255,0.35)', fontSize: 64, fontWeight: '900' },
  front: { backgroundColor: '#20305A', padding: 16, gap: 10 },
  art: { width: '70%', height: '55%' },
  newBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: '#FF5D73', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  newBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  name: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  avatarErrorText: { color: '#FFB4B4', fontSize: 13, textAlign: 'center' },
  srOnly: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  control: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  controlPrimary: { backgroundColor: '#FFD27A' },
  controlDisabled: { opacity: 0.45 },
  controlText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  controlTextPrimary: { color: '#14213A' },
});
