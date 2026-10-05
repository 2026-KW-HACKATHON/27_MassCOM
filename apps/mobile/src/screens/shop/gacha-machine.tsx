import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { ThemeOutfitPreview } from '@/experience/theme-pack-board';
import type { ExperienceProfile } from '@/experience/experience-api';
import { CosmeticArt, PackArt } from '@/illustration/artwork';
import { AvatarPortrait } from '@/illustration/avatar-portrait';
import { ConfettiBurst } from '@/gamification/confetti';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { lightHaptic, successHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { playUiSound } from '@/sound/ui-sounds';
import type { MileageGrade, ShopGradeView, ShopRerollResult, ShopSnapshot } from '@/shop/shop-api';
import { CharacterArt } from '@/illustration/character-art';
import { rerollDisclosure } from '@/shop/shop-rules';

import { themePackName, cosmeticSequenceDisclosure, gachaAffordability, gachaPhaseAfter, gachaTimeline, isNewDraw, type GachaPhase, type GachaStage } from './gacha-rules';

type Props = {
  snapshot: ShopSnapshot;
  profile?: ExperienceProfile;
  bonusSaving?: boolean;
  bonusError?: string;
  onEquipBonus?: () => void;
  result?: ShopRerollResult;
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
export function GachaMachine({ snapshot, profile, bonusSaving, bonusError, onEquipBonus, result, ownedBefore, busy, error, refreshing, avatarBusy, avatarError, isAvatar,
  wishId, onWish, onDraw, onSetAvatar, onClose, onRefresh, onOpenStudio }: Props) {
  const insets = useSafeAreaInsets();
  const motionAllowed = useMotionEnabled();
  const [phase, setPhase] = useState<GachaPhase>('picker');
  const phaseRef = useRef<typeof phase>('picker');
  const consumedResult = useRef<ShopRerollResult | undefined>(undefined);
  const activeResult = useRef<ShopRerollResult | undefined>(undefined);
  const skipRequested = useRef(false);
  const [drawing, setDrawing] = useState<ShopGradeView>();
  const timelineTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
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
  const baseProfile = profile ?? { badgeId: null, cosmetics: { hat: null, bag: null, prop: null, pose: null, decor: null } };
  const bonusProfile = result?.bonus ? { ...baseProfile, cosmetics: { ...baseProfile.cosmetics, [result.bonus.slot]: result.bonus.id } } : profile;
  const bonusEquipped = !!result?.bonus && profile?.cosmetics[result.bonus.slot] === result.bonus.id;
  const grade = result?.item.grade ?? drawing?.grade ?? 'BRONZE';
  const tone = gradeStyle[grade];

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
        const timer = setTimeout(() => { activeResult.current = undefined; advancePhase('result'); }, 0);
        return () => clearTimeout(timer);
      }
      return;
    }
    consumedResult.current = result;
    activeResult.current = result;
    if (!motionAllowed || result.replayed || skipRequested.current) {
      skipRequested.current = false;
      const timer = setTimeout(() => { activeResult.current = undefined; advancePhase('result'); }, 0);
      cardOpacity.set(withTiming(1, { duration: 180 }));
      cardScale.set(1);
      return () => clearTimeout(timer);
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
        case 'drop': capsuleDrop.set(withSpring(1, { damping: 8, stiffness: 130 })); void lightHaptic(); playUiSound('open'); break;
        case 'wobble': capsuleWobble.set(withSequence(withTiming(-15, { duration: 100 }), withTiming(15, { duration: 100 }), withTiming(0, { duration: 100 }))); break;
        case 'split': capsuleSplit.set(withTiming(1, { duration: durations.split, easing: Easing.out(Easing.cubic) })); playUiSound('flip'); break;
        case 'burst': burst.set(withTiming(1, { duration: durations.burst })); playUiSound('success'); break;
        case 'pop': cardOpacity.set(1); cardScale.set(withSpring(1, { damping: 7, stiffness: 180 })); void successHaptic(); break;
      }
    };
    stages.forEach((stage) => { timers.push(setTimeout(() => enter(stage), elapsed)); elapsed += durations[stage]; });
    timers.push(setTimeout(() => { activeResult.current = undefined; advancePhase('result'); }, elapsed));
    return () => timers.forEach(clearTimeout);
  }, [result, motionAllowed, advancePhase, burst, capsuleDrop, capsuleSplit, capsuleWobble, cardOpacity, cardScale, crank, jiggle, shake]);

  const machineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.get() }, { translateX: shake.get() }] }));
  const crankStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${crank.get()}deg` }] }));
  const dropStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -60 + capsuleDrop.get() * 90 }, { rotate: `${capsuleWobble.get()}deg` }] }));
  const splitStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -capsuleSplit.get() * 65 }, { rotate: `${capsuleSplit.get() * 42}deg` }] }));
  const burstStyle = useAnimatedStyle(() => ({ opacity: burst.get(), transform: [{ rotate: `${burst.get() * 35}deg` }, { scale: 0.7 + burst.get() * 0.6 }] }));
  const resultStyle = useAnimatedStyle(() => ({ opacity: cardOpacity.get(), transform: [{ scale: cardScale.get() }] }));

  const startDraw = async (selected: ShopGradeView) => {
    setDrawing(selected);
    skipRequested.current = false;
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
    if (next === 'picker' || !result) {
      skipRequested.current = false;
      advancePhase('picker');
      return;
    }
    timelineTimers.current.forEach(clearTimeout);
    crank.set(360); shake.set(0); jiggle.set(0); capsuleDrop.set(1); capsuleWobble.set(0); capsuleSplit.set(1);
    burst.set(1); cardScale.set(1); cardOpacity.set(1); activeResult.current = undefined; advancePhase('result');
  };
  const displayPhase = phase;
  const showResult = displayPhase === 'result' || displayPhase === 'pop';
  const animating = result && displayPhase !== 'picker' && displayPhase !== 'pending' && displayPhase !== 'result';

  return (
    <FullScreenModal visible animationType="fade" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.topBar}>
          <Text style={styles.balance}>보유 {snapshot.mileage.balance.toLocaleString('ko-KR')} 마일리지</Text>
          {animating || displayPhase === 'pending' ? <Control label="건너뛰기" onPress={skip} /> : <Control label="닫기" onPress={onClose} />}
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {displayPhase === 'picker' ? (
            <>
              <Text accessibilityRole="header" style={styles.heading}>어떤 친구를 만날까요?</Text>
              <Text style={styles.description}>테마 팩을 열어 해당 등급의 미보유 캐릭터와 꾸미기를 모아요.</Text>
              <View style={styles.catalog}>
                {snapshot.items.map((item) => <Pressable key={item.id} accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${gradeStyle[item.grade].name}, ${item.owned ? '소유 중' : wishId === item.id ? '내 목표' : '목표로 보기'}`}
                  accessibilityState={{ selected: wishId === item.id, disabled: item.owned }} disabled={item.owned}
                  onPress={() => onWish?.(wishId === item.id ? null : item.id)}
                  style={[styles.catalogItem, { borderColor: wishId === item.id ? '#FFCE70' : 'transparent' }]}>
                  <CharacterArt avatar={item.id} frame="calm" size={70} />
                  <Text style={styles.catalogName}>{item.name}</Text>
                  <Text style={styles.catalogStatus}>{item.owned ? '함께해요' : wishId === item.id ? '내 목표' : gradeStyle[item.grade].name}</Text>
                </Pressable>)}
              </View>
              {wishId ? <Text accessibilityLiveRegion="polite" style={styles.description}>목표로 표시했어요. 뽑기 확률은 같은 등급의 미보유 친구에게 동일해요.</Text> : null}
              <Machine tone={tone} machineStyle={machineStyle} crankStyle={crankStyle} jiggle={jiggle} />
              <View style={styles.tickets}>
                {snapshot.grades.map((item) => {
                  const available = availability.find((entry) => entry.grade === item.grade)!;
                  const label = `${themePackName(item.grade)} · ${gradeStyle[item.grade].name} 캐릭터`;
                  return <Pressable key={item.grade} accessibilityRole="button" accessibilityLabel={`${label} ${item.price}마일리지${available.reason ? `, ${available.reason}` : ''}`}
                    accessibilityState={{ disabled: !available.enabled || busy || !!refreshing }} disabled={!available.enabled || busy || refreshing}
                    onPress={() => { void startDraw(item); }} style={[styles.ticketButton, !available.enabled && styles.disabled]}>
                    <PackArt grade={item.grade} size={80} />
                    <View style={styles.ticketCopy}><Text style={styles.ticketName}>{label} · {item.price}P</Text><Text style={styles.ticketNote}>{available.reason ?? rerollDisclosure(item)}</Text><Text style={styles.ticketNote}>{cosmeticSequenceDisclosure}</Text></View>
                  </Pressable>;
                })}
              </View>
            </>
          ) : displayPhase === 'pending' ? (
            <>
              <Text accessibilityRole="header" style={styles.heading}>친구를 만나러 가는 중…</Text>
              <Machine tone={tone} machineStyle={machineStyle} crankStyle={crankStyle} jiggle={jiggle} />
              <Text accessibilityLiveRegion="polite" style={styles.description}>뽑기 결과를 확인하고 있어요.</Text>
            </>
          ) : result ? (
            <>
              <Text accessibilityRole="header" style={styles.heading}>{showResult ? '새 친구를 만났어요!' : '두근두근, 누가 나올까요?'}</Text>
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
                <Animated.View style={[styles.resultCard, { borderColor: tone.color }, resultStyle]} accessible accessibilityLabel={`결과: ${result.item.name}`}>
                <Text style={[styles.gradePill, { backgroundColor: tone.color }]}>{tone.name}</Text>
                {isNewDraw(result.item, ownedBefore) ? <Text style={styles.newBadge}>NEW</Text> : null}
                <AvatarPortrait avatar={result.item.id} profile={bonusProfile} size={240} reaction="cheer" animated={motionAllowed} />
                <Text style={styles.characterName}>{result.item.name}</Text>
                {result.bonus ? <View style={styles.bonusReveal}>
                  <CosmeticArt id={result.bonus.id} size={82} /><View style={styles.ticketCopy}>
                    <Text style={styles.description}>함께 얻은 꾸미기</Text><Text style={styles.catalogName}>{result.bonus.name}</Text>
                    <Text style={styles.ticketNote}>{bonusEquipped ? result.bonus.slot === 'decor' ? '배치 완료' : '장착 완료' : result.bonus.slot === 'decor' ? '공간 장식 · 아래에서 배치 미리보기' : '착용 미리보기 · 아직 장착하지 않았어요'}</Text>
                  </View>
                </View> : null}
                <Text style={styles.description}>{wishId === result.item.id ? '기다리던 동행을 만났어요!' : '내 공간에서 함께 놀고, 가게를 탐험해요.'}</Text>
                <Text style={styles.resultBalance}>남은 마일리지 {result.balance.toLocaleString('ko-KR')}P</Text>
                </Animated.View>
              </View>}
              {displayPhase === 'result' ? <View style={styles.actions}>
                {avatarError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{avatarError}</Text> : null}
                {result.bonus?.slot === 'decor' ? <View style={{ alignItems: 'center', gap: 8 }}>
                  <ThemeOutfitPreview avatar={snapshot.avatar} profile={bonusProfile} />
                  <Text style={styles.description}>참고용 배치 미리보기 · 실제 배치는 내 공간에서 확인해요</Text>
                </View> : null}
                {result.bonus && result.bonus.slot !== 'decor' && profile ? <View style={styles.bonusReveal}>
                  <AvatarPortrait avatar={snapshot.avatar} profile={bonusProfile} size={104} reaction="idle" />
                  <Text style={[styles.description, styles.ticketCopy]}>지금 동행에게 입혀 본 모습{bonusEquipped ? ' · 장착 완료' : ''}</Text>
                </View> : null}
                {bonusError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{bonusError}</Text> : null}
                {result.bonus && onEquipBonus ? <Control label={bonusSaving ? '꾸미기 저장 중…' : bonusEquipped ? result.bonus?.slot === 'decor' ? '장식 배치 완료' : '꾸미기 장착 완료' : result.bonus?.slot === 'decor' ? '내 공간에 이 장식 배치' : '지금 동행에게 꾸미기 장착'} disabled={avatarBusy || bonusSaving || bonusEquipped} onPress={onEquipBonus} /> : null}
                <Control label={isAvatar ? '대표 캐릭터예요' : avatarBusy ? '설정 중…' : '대표 캐릭터로'} primary disabled={isAvatar || avatarBusy || bonusSaving} onPress={onSetAvatar} />
                {onOpenStudio ? <Control label={result.bonus?.slot === 'decor' ? '내 공간에 놓으러 가기' : '내 공간에서 만나기'} disabled={avatarBusy || bonusSaving} onPress={onOpenStudio} /> : null}
                {canRepeat ? <Control label="한 번 더 뽑기" disabled={avatarBusy || bonusSaving} onPress={() => { activeResult.current = undefined; advancePhase('picker'); }} /> : null}
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

function Control({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[styles.control, primary && styles.primary, disabled && styles.disabled]}><Text style={[styles.controlText, primary && styles.primaryText]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: '#142724', paddingHorizontal: 22 },
  topBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balance: { color: '#FFE5A4', fontSize: 15, fontWeight: '800' },
  scroll: { flex: 1, minHeight: 0 },
  content: { alignItems: 'center', paddingBottom: 24, gap: 14 },
  heading: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  description: { color: '#D9E7FA', fontSize: 15, textAlign: 'center' },
  catalog: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  catalogItem: { width: '30%', minWidth: 80, alignItems: 'center', gap: 3, padding: 4, borderWidth: 2, borderRadius: 8 },
  catalogArt: { width: 64, height: 70 },
  catalogName: { color: '#FFFFFF', fontSize: 12, textAlign: 'center', lineHeight: 17 },
  catalogStatus: { color: '#FFE5A4', fontSize: 11, textAlign: 'center' },
  machine: { width: 240, height: 270, alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  innerCapsule: { position: 'absolute', width: 38, height: 38, borderRadius: 19, borderColor: '#FFFFFF', borderWidth: 3 },
  crank: { position: 'absolute', left: 93, top: 145, width: 54, height: 54 },
  tickets: { alignSelf: 'stretch', gap: 10 },
  ticketButton: { minHeight: 72, paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#29473F', borderRadius: 8, borderWidth: 1, borderColor: '#718C77' },
  ticketArt: { width: 64, height: 54 },
  ticketCopy: { flex: 1 },
  ticketName: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  ticketNote: { color: '#BED0E6', fontSize: 13, marginTop: 3 },
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
  character: { width: 250, height: 260, maxWidth: '100%' },
  missingCharacter: { color: '#FFFFFF', fontSize: 90, fontWeight: '900' },
  characterName: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', textAlign: 'center', flexShrink: 1 },
  bonusReveal: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 10, borderRadius: 14, backgroundColor: '#29473F' },
  resultBalance: { color: '#D9E7FA', fontSize: 14 },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 8 },
  control: { minHeight: 48, minWidth: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#29473F' },
  primary: { backgroundColor: '#FFD579' },
  controlText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  primaryText: { color: '#182942' },
  error: { color: '#FFD1D1', fontSize: 14, textAlign: 'center', marginTop: 4 },
  errorArea: { alignSelf: 'stretch', gap: 8 },
});
