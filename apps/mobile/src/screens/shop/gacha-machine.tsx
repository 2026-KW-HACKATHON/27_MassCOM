import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { ConfettiBurst } from '@/gamification/confetti';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { drawHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { playUiSound, useDrawMusic } from '@/sound/ui-sounds';
import type { MileageGrade, ShopGradeView, ShopRerollResult, ShopSnapshot } from '@/shop/shop-api';
import { friendArt, ticketArt } from '@/shop/shop-art';
import { AvatarWardrobe, equippedClothingArt } from '@/shop/wardrobe';
import { drawRewardDisclosure, rerollDisclosure } from '@/shop/shop-rules';

import { cosmeticSequenceDisclosure, gachaAffordability, gachaNextRewardPhase, gachaPhaseAfter, gachaRewardDelayMs, gachaTimeline, isNewDraw, type GachaPhase, type GachaRewardPhase, type GachaStage } from './gacha-rules';

type Props = {
  snapshot: ShopSnapshot;
  result?: ShopRerollResult;
  selectedGrade: MileageGrade;
  ownedBefore: readonly string[];
  busy: boolean;
  error?: string;
  refreshing?: boolean;
  avatarBusy: boolean;
  avatarError?: string;
  isAvatar?: boolean;
  wishId?: string | null;
  onWish?: (itemId: string | null) => void;
  onDraw: (grade: ShopGradeView) => Promise<boolean>;
  onSetAvatar: () => void;
  onClose: () => void;
  onRefresh?: () => void;
  onOpenStudio?: () => void;
};

const gradeStyle: Record<MileageGrade, { name: string; color: string; pale: string }> = {
  BRONZE: { name: '브론즈', color: '#D99665', pale: '#FFE1C4' },
  SILVER: { name: '실버', color: '#B9D2E8', pale: '#E8F5FF' },
  GOLD: { name: '골드', color: '#F8C758', pale: '#FFF2B8' },
};
const stages: GachaStage[] = ['crank', 'shake', 'drop', 'wobble', 'split', 'burst', 'pop'];

/** The same full-screen purchase experience opens from the shop and the visit reward reel. */
export function GachaMachine({ snapshot, result, selectedGrade, ownedBefore, busy, error, refreshing, avatarBusy, avatarError, isAvatar,
  wishId, onWish, onDraw, onSetAvatar, onClose, onRefresh, onOpenStudio }: Props) {
  const insets = useSafeAreaInsets();
  const motionAllowed = useMotionEnabled();
  useDrawMusic();
  const [phase, setPhase] = useState<GachaPhase>('detail');
  const phaseRef = useRef<typeof phase>('detail');
  const consumedResult = useRef<ShopRerollResult | undefined>(undefined);
  const activeResult = useRef<ShopRerollResult | undefined>(undefined);
  const skipRequested = useRef(false);
  const [drawing, setDrawing] = useState<ShopGradeView>();
  const [pendingCloseMessage, setPendingCloseMessage] = useState<string>();
  const timelineTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rewardTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const advancePhase = useCallback((next: typeof phase) => { phaseRef.current = next; setPhase(next); }, []);
  const bob = useSharedValue(0);
  const shake = useSharedValue(0);
  const jiggle = useSharedValue(0);
  const crank = useSharedValue(0);
  const capsuleDrop = useSharedValue(0);
  const capsuleWobble = useSharedValue(0);
  const capsuleSplit = useSharedValue(0);
  const burst = useSharedValue(0);
  const cardScale = useSharedValue(0.55);
  const cardOpacity = useSharedValue(0);

  const ownedByGrade = useMemo(() => snapshot.items.reduce<Partial<Record<MileageGrade, number>>>((counts, item) => {
    if (item.owned) counts[item.grade] = (counts[item.grade] ?? 0) + 1;
    return counts;
  }, {}), [snapshot.items]);
  const availability = gachaAffordability(snapshot.mileage.balance, snapshot.grades, ownedByGrade);
  const canRepeat = availability.some((entry) => entry.enabled);
  const selected = snapshot.grades.find((item) => item.grade === selectedGrade) ?? snapshot.grades[0]!;
  void onWish;
  const selectedAvailability = availability.find((entry) => entry.grade === selected.grade)!;
  const grade = result?.item.grade ?? drawing?.grade ?? selected.grade;
  const tone = gradeStyle[grade];

  const clearRewardTimer = useCallback(() => {
    if (rewardTimer.current) clearTimeout(rewardTimer.current);
    rewardTimer.current = undefined;
  }, []);
  const startRewardRevealRef = useRef<(next?: GachaRewardPhase | 'result') => void>(() => {});
  const startRewardReveal = useCallback((next: GachaRewardPhase | 'result' = 'reward-mileage') => {
    clearRewardTimer();
    activeResult.current = undefined;
    cardOpacity.set(1);
    cardScale.set(1);
    if (next === 'result') {
      advancePhase('result');
      return;
    }
    advancePhase(next);
    void drawHaptic();
    playUiSound(next === 'reward-character' ? 'success' : 'flip');
    rewardTimer.current = setTimeout(() => startRewardRevealRef.current(gachaNextRewardPhase(next)), gachaRewardDelayMs(motionAllowed));
  }, [advancePhase, cardOpacity, cardScale, clearRewardTimer, motionAllowed]);
  useEffect(() => { startRewardRevealRef.current = startRewardReveal; }, [startRewardReveal]);
  const revealNext = useCallback(() => {
    const current = phaseRef.current;
    if (current === 'reward-mileage' || current === 'reward-clothing' || current === 'reward-character') startRewardReveal(gachaNextRewardPhase(current));
  }, [startRewardReveal]);

  useFocusEffect(useCallback(() => {
    if (motionAllowed) bob.set(withRepeat(withSequence(withTiming(-5, { duration: 1100 }), withTiming(0, { duration: 1100 })), -1));
    return () => { cancelAnimation(bob); bob.set(0); };
  }, [bob, motionAllowed]));

  useEffect(() => {
    if (!result) return;
    if (consumedResult.current === result) {
      // Effect cleanup can cancel the timeline on an OS setting change or StrictMode re-setup.
      // Finish that in-flight result once; a repeat picker has cleared activeResult below.
      if (activeResult.current === result && phaseRef.current !== 'result') {
        timelineTimers.current.forEach(clearTimeout);
        crank.set(360); shake.set(0); jiggle.set(0); capsuleDrop.set(1); capsuleWobble.set(0); capsuleSplit.set(1);
        burst.set(1); cardScale.set(1); cardOpacity.set(1);
        const timer = setTimeout(() => startRewardReveal('reward-mileage'), 0);
        return () => { clearTimeout(timer); clearRewardTimer(); };
      }
      return;
    }
    consumedResult.current = result;
    activeResult.current = result;
    if (!motionAllowed || result.replayed || skipRequested.current) {
      skipRequested.current = false;
      const timer = setTimeout(() => startRewardReveal('reward-mileage'), 0);
      cardOpacity.set(withTiming(1, { duration: 180 }));
      cardScale.set(1);
      return () => { clearTimeout(timer); clearRewardTimer(); };
    }
    const durations = gachaTimeline(false);
    const timers: ReturnType<typeof setTimeout>[] = [];
    timelineTimers.current = timers;
    let elapsed = 0;
    const enter = (stage: GachaStage) => {
      advancePhase(stage);
      switch (stage) {
        case 'crank': crank.set(withTiming(360, { duration: durations.crank })); break;
        case 'shake':
          shake.set(withSequence(withTiming(-8, { duration: 75 }), withTiming(8, { duration: 75 }), withTiming(-8, { duration: 75 }), withTiming(8, { duration: 75 }), withTiming(-7, { duration: 75 }), withTiming(0, { duration: 75 })));
          jiggle.set(withSequence(withTiming(1, { duration: 75 }), withTiming(-1, { duration: 75 }), withTiming(1, { duration: 75 }), withTiming(-1, { duration: 75 }), withTiming(1, { duration: 75 }), withTiming(0, { duration: 75 })));
          break;
        case 'drop': capsuleDrop.set(withSpring(1, { damping: 8, stiffness: 130 })); void drawHaptic(); playUiSound('open'); break;
        case 'wobble': capsuleWobble.set(withSequence(withTiming(-15, { duration: 100 }), withTiming(15, { duration: 100 }), withTiming(0, { duration: 100 }))); break;
        case 'split': capsuleSplit.set(withTiming(1, { duration: durations.split, easing: Easing.out(Easing.cubic) })); playUiSound('flip'); break;
        case 'burst': burst.set(withTiming(1, { duration: durations.burst })); playUiSound('success'); break;
        case 'pop': cardOpacity.set(1); cardScale.set(withSpring(1, { damping: 7, stiffness: 180 })); void drawHaptic(); break;
      }
    };
    stages.forEach((stage) => { timers.push(setTimeout(() => enter(stage), elapsed)); elapsed += durations[stage]; });
    timers.push(setTimeout(() => startRewardReveal('reward-mileage'), elapsed));
    return () => { timers.forEach(clearTimeout); clearRewardTimer(); };
  }, [result, motionAllowed, advancePhase, burst, capsuleDrop, capsuleSplit, capsuleWobble, cardOpacity, cardScale, clearRewardTimer, crank, jiggle, shake, startRewardReveal]);

  const machineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.get() }, { translateX: shake.get() }] }));
  const crankStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${crank.get()}deg` }] }));
  const dropStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -60 + capsuleDrop.get() * 90 }, { rotate: `${capsuleWobble.get()}deg` }] }));
  const splitStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -capsuleSplit.get() * 65 }, { rotate: `${capsuleSplit.get() * 42}deg` }] }));
  const burstStyle = useAnimatedStyle(() => ({ opacity: burst.get(), transform: [{ rotate: `${burst.get() * 35}deg` }, { scale: 0.7 + burst.get() * 0.6 }] }));
  const resultStyle = useAnimatedStyle(() => ({ opacity: cardOpacity.get(), transform: [{ scale: cardScale.get() }] }));


  const startDraw = async (selected: ShopGradeView) => {
    setDrawing(selected);
    skipRequested.current = false;
    setPendingCloseMessage(undefined);
    clearRewardTimer();
    activeResult.current = undefined;
    advancePhase(gachaPhaseAfter(phaseRef.current, { type: 'draw-started' }));
    crank.set(0); shake.set(0); jiggle.set(0); capsuleDrop.set(0); capsuleWobble.set(0); capsuleSplit.set(0); burst.set(0);
    cardScale.set(0.55); cardOpacity.set(0);
    const succeeded = await onDraw(selected);
    if (!succeeded) {
      skipRequested.current = false;
      advancePhase(gachaPhaseAfter(phaseRef.current, { type: 'purchase-failed' }));
    }
  };
  const skip = () => {
    const next = gachaPhaseAfter(phaseRef.current, { type: 'skip', busy });
    if (next === 'pending') { skipRequested.current = true; return; }
    if (next === 'detail' || !result) {
      skipRequested.current = false;
      advancePhase('detail');
      return;
    }
    timelineTimers.current.forEach(clearTimeout);
    clearRewardTimer();
    crank.set(360); shake.set(0); jiggle.set(0); capsuleDrop.set(1); capsuleWobble.set(0); capsuleSplit.set(1);
    burst.set(1); cardScale.set(1); cardOpacity.set(1); startRewardReveal('reward-mileage');
  };
  const displayPhase = phase;
  const rewardPhase = displayPhase === 'reward-mileage' || displayPhase === 'reward-clothing' || displayPhase === 'reward-character' ? displayPhase : undefined;
  const showResult = !!rewardPhase || displayPhase === 'result' || displayPhase === 'pop';
  const animating = result && displayPhase !== 'detail' && displayPhase !== 'pending' && !rewardPhase && displayPhase !== 'result';
  const requestClose = () => {
    if (displayPhase === 'pending') {
      setPendingCloseMessage('구매 확인 중이에요. 결과를 받으면 닫을 수 있어요.');
      return;
    }
    onClose();
  };

  return (
    <FullScreenModal visible animationType="fade" onRequestClose={requestClose}>
      <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.topBar}>
          <Text style={styles.balance}>보유 {snapshot.mileage.balance.toLocaleString('ko-KR')} 마일리지</Text>
          {animating ? <Control label="건너뛰기" onPress={skip} /> : displayPhase === 'pending'
            ? <Control label="구매 확인 중" disabled onPress={() => {}} />
            : <Control label="닫기" onPress={onClose} />}
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {displayPhase === 'detail' ? (
            <>
              <Text accessibilityRole="header" style={styles.heading}>{gradeStyle[selected.grade].name} 재뽑기권</Text>
              <Image source={ticketArt[selected.grade]} style={styles.detailTicketArt} resizeMode="contain" accessible={false} />
              <View style={styles.rewardList}>
                <Text style={styles.rewardLine}>마일리지 {snapshot.drawRewards.bonusMileage.min}-{snapshot.drawRewards.bonusMileage.max}P</Text>
                <Text style={styles.rewardLine}>아바타 옷 0-1개</Text>
                <Text style={styles.rewardLine}>캐릭터 1명</Text>
                <Text style={styles.rewardLine}>추가 꾸미기 별도 보너스</Text>
              </View>
              {wishId ? <Text accessibilityLiveRegion="polite" style={styles.description}>목표 친구를 표시했어요. 뽑기 확률은 같은 등급의 미보유 친구에게 동일해요.</Text> : null}
              <Text style={styles.description}>{rerollDisclosure(selected)}</Text>
              <Text style={styles.description}>{drawRewardDisclosure(snapshot)}</Text>
              <Text style={styles.description}>{cosmeticSequenceDisclosure}</Text>
              {selectedAvailability.reason ? <Text style={styles.error}>{selectedAvailability.reason}</Text> : null}
              <Control
                label={`${selected.price.toLocaleString('ko-KR')} 마일리지`}
                purchase
                disabled={!selectedAvailability.enabled || busy || refreshing}
                onPress={() => { void startDraw(selected); }}
              />
            </>
          ) : displayPhase === 'pending' ? (
            <>
              <Text accessibilityRole="header" style={styles.heading}>친구를 만나러 가는 중…</Text>
              <Machine tone={tone} machineStyle={machineStyle} crankStyle={crankStyle} jiggle={jiggle} />
              <Text accessibilityLiveRegion="polite" style={styles.description}>뽑기 결과를 확인하고 있어요.</Text>
              {pendingCloseMessage ? <Text accessibilityLiveRegion="polite" style={styles.error}>{pendingCloseMessage}</Text> : null}
            </>
          ) : result ? (
            <>
              <Text accessibilityRole="header" style={styles.heading}>{rewardPhase ? '보상을 하나씩 열어요' : showResult ? '새 친구를 만났어요!' : '두근두근, 누가 나올까요?'}</Text>
              {!showResult ? (
                <View style={styles.machineArea}>
                  <Machine tone={tone} machineStyle={machineStyle} crankStyle={crankStyle} jiggle={jiggle} />
                  {['drop', 'wobble', 'split', 'burst'].includes(displayPhase) ? <Animated.View style={[styles.capsuleWrap, dropStyle]}>
                    <View style={[styles.capsuleBottom, { backgroundColor: tone.color }]} />
                    <Animated.View style={[styles.capsuleTop, { backgroundColor: tone.pale }, splitStyle]} />
                  </Animated.View> : null}
                  {displayPhase === 'burst' ? <Animated.View style={[styles.rays, burstStyle]}><BurstRays color={tone.color} /></Animated.View> : null}
                  {displayPhase === 'burst' ? <ConfettiBurst colors={[tone.color, tone.pale, '#FFFFFF']} leafColor={tone.color} originX={140} originY={160} width={280} height={280} count={grade === 'GOLD' ? 34 : grade === 'SILVER' ? 22 : 12} /> : null}
                </View>
              ) : <View style={styles.resultWrap}>
                {motionAllowed && !result.replayed ? <Animated.View pointerEvents="none" style={[styles.resultRays, burstStyle]}><BurstRays color={tone.color} /></Animated.View> : null}
                {motionAllowed && !result.replayed ? <ConfettiBurst colors={[tone.color, tone.pale, '#FFFFFF']} leafColor={tone.color} originX={150} originY={140} width={300} height={360} count={grade === 'GOLD' ? 34 : grade === 'SILVER' ? 22 : 12} /> : null}
                <Animated.View style={[styles.resultCard, { borderColor: tone.color }, resultStyle]} accessible accessibilityLabel={resultAccessibilityLabel(result, rewardPhase)}>
                  <Text style={[styles.gradePill, { backgroundColor: tone.color }]}>{tone.name}</Text>
                  {isNewDraw(result.item, ownedBefore) && (displayPhase === 'reward-character' || displayPhase === 'result') ? <Text style={styles.newBadge}>NEW</Text> : null}
                  {displayPhase === 'reward-mileage' ? <MileageReward amount={result.rewards.mileage.amount} onNext={revealNext} /> : null}
                  {displayPhase === 'reward-clothing' ? <ClothingReward result={result} onNext={revealNext} /> : null}
                  {displayPhase === 'reward-character' ? <CharacterReward result={result} wished={wishId === result.item.id} onNext={revealNext} /> : null}
                  {displayPhase === 'result' ? <ResultSummary result={result} tone={tone} ownedBefore={ownedBefore} /> : null}
                </Animated.View>
              </View>}
              {displayPhase === 'result' ? <View style={styles.actions}>
                {avatarError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{avatarError}</Text> : null}
                <Control label={isAvatar ? '대표 캐릭터예요' : avatarBusy ? '설정 중…' : '대표 캐릭터로'} primary disabled={isAvatar || avatarBusy} onPress={onSetAvatar} />
                {onOpenStudio ? <Control label="내 공간에서 만나기" disabled={avatarBusy} onPress={onOpenStudio} /> : null}
                {canRepeat ? <Control label="한 번 더 뽑기" disabled={avatarBusy} onPress={() => { clearRewardTimer(); activeResult.current = undefined; advancePhase('detail'); }} /> : null}
                <Control label="닫기" onPress={onClose} />
              </View> : null}
            </>
          ) : null}
          {error ? <View style={styles.errorArea}><Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>
            {onRefresh ? <Control label={refreshing ? '다시 불러오는 중…' : '상점 다시 불러오기'} disabled={busy || refreshing} onPress={onRefresh} /> : null}
          </View> : null}
        </ScrollView>
      </View>
    </FullScreenModal>
  );
}


function resultAccessibilityLabel(result: ShopRerollResult, phase: GachaRewardPhase | undefined): string {
  if (phase === 'reward-mileage') return `보상 1/3: 마일리지 ${result.rewards.mileage.amount}포인트`;
  if (phase === 'reward-clothing') return `보상 2/3: ${clothingRewardName(result)}`;
  if (phase === 'reward-character') return `보상 3/3: 캐릭터 ${result.item.name}`;
  return `최종 결과: 마일리지 ${result.rewards.mileage.amount}포인트, ${clothingRewardName(result)}, 캐릭터 ${result.item.name}`;
}

function clothingRewardName(result: ShopRerollResult): string {
  return result.rewards.clothing.item
    ? `옷 ${result.rewards.clothing.item.name}${result.rewards.clothing.duplicate ? ' 이미 보유' : ''}`
    : '옷 없음';
}

function MileageReward({ amount, onNext }: { amount: number; onNext: () => void }) {
  return <>
    <Text style={styles.rewardKicker}>1 / 3</Text>
    <Text style={styles.rewardTitle}>마일리지 보너스</Text>
    <Text style={styles.mileagePrize}>+{amount}P</Text>
    <Text style={styles.description}>뽑을 때마다 추가 마일리지를 받아요.</Text>
    <Control label="다음 보상 보기" primary onPress={onNext} />
  </>;
}

function ClothingReward({ result, onNext }: { result: ShopRerollResult; onNext: () => void }) {
  const clothing = result.rewards.clothing.item
    ? equippedClothingArt({ clothing: { equipped: result.rewards.clothing.item.id, draw: { probability: result.rewards.clothing.probability }, items: [{ ...result.rewards.clothing.item, owned: true, equipped: true }] } })
    : null;
  return <>
    <Text style={styles.rewardKicker}>2 / 3</Text>
    <Text style={styles.rewardTitle}>아바타 옷</Text>
    <View style={styles.clothingPrize}>{clothing ? <AvatarWardrobe clothing={clothing} size={118} /> : <Text style={styles.noPrize}>이번에는 없음</Text>}</View>
    <Text style={styles.characterName}>{result.rewards.clothing.item ? result.rewards.clothing.item.name : '옷 없음'}</Text>
    {result.rewards.clothing.duplicate ? <Text style={styles.description}>이미 가지고 있어요. 보유 옷은 그대로 유지돼요.</Text> : null}
    <Control label="다음 보상 보기" primary onPress={onNext} />
  </>;
}

function CharacterReward({ result, wished, onNext }: { result: ShopRerollResult; wished?: boolean; onNext: () => void }) {
  return <>
    <Text style={styles.rewardKicker}>3 / 3</Text>
    <Text style={styles.rewardTitle}>새 친구</Text>
    {friendArt[result.item.id] ? <Image source={friendArt[result.item.id]} style={styles.character} resizeMode="contain" accessible={false} /> : <Text style={styles.missingCharacter}>?</Text>}
    <Text style={styles.characterName}>{result.item.name}</Text>
    <Text style={styles.description}>{wished ? '기다리던 동행을 만났어요!' : '내 공간에서 함께 놀고, 가게를 탐험해요.'}</Text>
    <Control label="최종 결과 보기" primary onPress={onNext} />
  </>;
}

function ResultSummary({ result, tone, ownedBefore }: { result: ShopRerollResult; tone: { color: string }; ownedBefore: readonly string[] }) {
  return <>
    {isNewDraw(result.item, ownedBefore) ? <Text style={styles.newBadge}>NEW</Text> : null}
    <Text style={styles.rewardTitle}>최종 결과</Text>
    <Text style={styles.rewardStep}>1. 마일리지 +{result.rewards.mileage.amount}P</Text>
    <Text style={styles.rewardStep}>2. 옷 {result.rewards.clothing.item ? `${result.rewards.clothing.item.name}${result.rewards.clothing.duplicate ? ' (이미 보유)' : ''}` : '이번에는 없음'}</Text>
    <Text style={styles.rewardStep}>3. 캐릭터 {result.item.name}</Text>
    {result.bonus ? <Text style={styles.rewardStep}>추가 꾸미기 {result.bonus.name}</Text> : null}
    {friendArt[result.item.id] ? <Image source={friendArt[result.item.id]} style={styles.summaryCharacter} resizeMode="contain" accessible={false} /> : <Text style={styles.missingCharacter}>?</Text>}
    <Text style={[styles.characterName, { color: tone.color }]}>{result.item.name}</Text>
    <Text style={styles.resultBalance}>남은 마일리지 {result.balance.toLocaleString('ko-KR')}P</Text>
  </>;
}

function Machine({ tone, machineStyle, crankStyle, jiggle }: { tone: { color: string; pale: string }; machineStyle: object; crankStyle: object; jiggle: SharedValue<number> }) {
  return <Animated.View style={[styles.machine, machineStyle]} accessibilityLabel="뽑기 기계" accessible>
    <Svg width={240} height={270} viewBox="0 0 240 270">
      <Defs><LinearGradient id="dome" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.68" /><Stop offset="1" stopColor="#AFDBF2" stopOpacity="0.18" /></LinearGradient></Defs>
      <Ellipse cx="120" cy="246" rx="105" ry="13" fill="#081528" opacity="0.4" />
      <Path d="M34 130 V104a86 86 0 0 1 172 0v26z" fill="#8BBFE0" stroke="#E7F7FF" strokeWidth="6" />
      <Path d="M34 130 V104a86 86 0 0 1 172 0v26z" fill="url(#dome)" />
      <Path d="M62 60 Q71 36 91 29" fill="none" stroke="#FFFFFF" strokeWidth="7" opacity="0.7" strokeLinecap="round" />
      <Rect x="25" y="127" width="190" height="94" rx="22" fill="#FFCB72" stroke="#FFF0C8" strokeWidth="5" />
      <Rect x="66" y="204" width="108" height="41" rx="12" fill="#E2A558" />
      <Rect x="80" y="210" width="80" height="35" rx="9" fill="#263A58" />
      <Path d="M89 233h62" stroke="#607C9B" strokeWidth="3" />
      <Circle cx="120" cy="172" r="29" fill="#FFF4D1" stroke="#CE914E" strokeWidth="4" />
    </Svg>
    <JiggleCapsule x={64} y={82} color={tone.color} factor={1} jiggle={jiggle} />
    <JiggleCapsule x={115} y={73} color="#FFC578" factor={-1.4} jiggle={jiggle} />
    <JiggleCapsule x={146} y={93} color="#D5B7F3" factor={0.8} jiggle={jiggle} />
    <JiggleCapsule x={91} y={101} color={tone.pale} factor={-0.9} jiggle={jiggle} />
    <Animated.View style={[styles.crank, crankStyle]}><Svg width={54} height={54} viewBox="0 0 54 54"><Line x1="27" y1="6" x2="27" y2="48" stroke="#C67C40" strokeWidth="7" strokeLinecap="round" /><Line x1="6" y1="27" x2="48" y2="27" stroke="#C67C40" strokeWidth="7" strokeLinecap="round" /><Circle cx="27" cy="27" r="8" fill="#FFDF88" /></Svg></Animated.View>
  </Animated.View>;
}

function JiggleCapsule({ x, y, color, factor, jiggle }: { x: number; y: number; color: string; factor: number; jiggle: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: jiggle.get() * 7 * factor }, { translateY: Math.abs(jiggle.get()) * -4 * Math.abs(factor) }, { rotate: `${jiggle.get() * 12 * factor}deg` }] }));
  return <Animated.View style={[styles.innerCapsule, { left: x, top: y, backgroundColor: color }, style]} />;
}

function BurstRays({ color }: { color: string }) {
  return <Svg width={240} height={240} viewBox="0 0 240 240"><G>{Array.from({ length: 12 }, (_, index) => <Line key={index} x1="120" y1="24" x2="120" y2="5" stroke={color} strokeWidth={index % 2 ? 3 : 6} strokeLinecap="round" transform={`rotate(${index * 30} 120 120)`} />)}</G></Svg>;
}

function Control({ label, onPress, primary, purchase, disabled }: { label: string; onPress: () => void; primary?: boolean; purchase?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[styles.control, primary && styles.primary, purchase && styles.purchase, disabled && styles.disabled]}><Text style={[styles.controlText, (primary || purchase) && styles.primaryText]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#142724', paddingHorizontal: 22 },
  topBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balance: { color: '#FFE5A4', fontSize: 15, fontWeight: '800' },
  content: { alignItems: 'center', paddingBottom: 24, gap: 14 },
  heading: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  description: { color: '#D9E7FA', fontSize: 15, textAlign: 'center' },
  detailTicketArt: { width: 190, height: 150 },
  rewardList: { alignSelf: 'stretch', gap: 8, marginVertical: 4 },
  rewardLine: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  rewardStep: { color: '#FFE5A4', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  machine: { width: 240, height: 270, alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  innerCapsule: { position: 'absolute', width: 38, height: 38, borderRadius: 19, borderColor: '#FFFFFF', borderWidth: 3 },
  crank: { position: 'absolute', left: 93, top: 145, width: 54, height: 54 },
  disabled: { opacity: 0.48 },
  machineArea: { width: 280, height: 320, alignItems: 'center', justifyContent: 'flex-start' },
  capsuleWrap: { position: 'absolute', top: 202, width: 68, height: 68 },
  capsuleBottom: { position: 'absolute', top: 30, width: 68, height: 38, borderBottomLeftRadius: 34, borderBottomRightRadius: 34, borderWidth: 3, borderColor: '#FFFFFF' },
  capsuleTop: { position: 'absolute', top: 0, width: 68, height: 38, borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 3, borderColor: '#FFFFFF' },
  rays: { position: 'absolute', top: 62, left: 20 },
  resultCard: { width: '100%', minHeight: 390, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 8 },
  resultWrap: { alignSelf: 'stretch', minHeight: 340, alignItems: 'center', justifyContent: 'center' },
  resultRays: { position: 'absolute', top: 45, left: '50%', marginLeft: -120 },
  gradePill: { color: '#18304B', fontWeight: '900', overflow: 'hidden', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 5, alignSelf: 'flex-start' },
  newBadge: { position: 'absolute', right: 18, top: 20, color: '#FFFFFF', backgroundColor: '#F25B73', borderRadius: 999, overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 5, fontWeight: '900' },
  rewardKicker: { color: '#FFE5A4', fontSize: 16, fontWeight: '900', letterSpacing: 1.2 },
  rewardTitle: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', textAlign: 'center' },
  mileagePrize: { color: '#FFE5A4', fontSize: 62, fontWeight: '900', textAlign: 'center' },
  clothingPrize: { minHeight: 130, alignItems: 'center', justifyContent: 'center' },
  noPrize: { color: '#D9E7FA', fontSize: 34, fontWeight: '900', textAlign: 'center' },
  character: { width: 250, height: 260, maxWidth: '100%' },
  missingCharacter: { color: '#FFFFFF', fontSize: 90, fontWeight: '900' },
  characterName: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', textAlign: 'center', flexShrink: 1 },
  summaryCharacter: { width: 150, height: 150, maxWidth: '100%' },
  resultBalance: { color: '#D9E7FA', fontSize: 14 },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 8 },
  control: { minHeight: 48, minWidth: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#29473F' },
  primary: { backgroundColor: '#FFD579' },
  purchase: { alignSelf: 'stretch', backgroundColor: '#2E8B57', marginTop: 4 },
  controlText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  primaryText: { color: '#182942' },
  error: { color: '#FFD1D1', fontSize: 14, textAlign: 'center', marginTop: 4 },
  errorArea: { alignSelf: 'stretch', gap: 8 },
});
