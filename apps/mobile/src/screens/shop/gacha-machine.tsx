import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { G, Line } from 'react-native-svg';

import { ThemeOutfitPreview } from '@/experience/theme-pack-board';
import type { DisplayExperienceProfile, ExperienceProfile } from '@/experience/experience-api';
import { RegistrationAlbum, type RegistrationItem } from '@/acquisition/registration-album';
import { CosmeticArt } from '@/illustration/artwork';
import { AvatarPortrait } from '@/illustration/avatar-portrait';
import { ConfettiBurst } from '@/gamification/confetti';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { drawHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { playUiSound, useDrawMusic } from '@/sound/ui-sounds';
import type { MileageGrade, ShopGradeView, ShopRerollResult, ShopSnapshot } from '@/shop/shop-api';
import { CharacterArt } from '@/illustration/character-art';
import { AvatarWardrobe, equippedClothingArt, type EquippedClothingArt } from '@/shop/wardrobe';
import { drawRewardDisclosure, rerollDisclosure } from '@/shop/shop-rules';

import { cosmeticSequenceDisclosure, gachaAffordability, gachaNextRewardPhase, gachaPhaseAfter, isNewDraw, type GachaPhase, type GachaRewardPhase } from './gacha-rules';
import { StampDrawStage } from './stamp-draw-stage';

type Props = {
  snapshot: ShopSnapshot;
  profile?: ExperienceProfile;
  bonusSaving?: boolean;
  bonusError?: string;
  onEquipBonus?: () => void;
  onRecoverPending?: () => void;
  result?: ShopRerollResult;
  receiptId?: string;
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

export const gradeStyle: Record<MileageGrade, { name: string; color: string; pale: string }> = {
  BRONZE: { name: '브론즈', color: '#D99665', pale: '#FFE1C4' },
  SILVER: { name: '실버', color: '#B9D2E8', pale: '#E8F5FF' },
  GOLD: { name: '골드', color: '#F8C758', pale: '#FFF2B8' },
};
/** The same full-screen purchase experience opens from the shop and the visit reward reel. */
export function GachaMachine({ snapshot, profile, bonusSaving, bonusError, onEquipBonus, result, selectedGrade, ownedBefore, busy, error, refreshing, avatarBusy, avatarError, isAvatar,
  receiptId, wishId, onWish, onRecoverPending, onDraw, onSetAvatar, onClose, onRefresh, onOpenStudio }: Props) {
  const insets = useSafeAreaInsets();
  const motionAllowed = useMotionEnabled();
  useDrawMusic();
  const [phase, setPhase] = useState<GachaPhase | 'opening'>('detail');
  const [openingFinished, setOpeningFinished] = useState(false);
  const phaseRef = useRef<typeof phase>('detail');
  const consumedResult = useRef<ShopRerollResult | undefined>(undefined);
  const activeResult = useRef<ShopRerollResult | undefined>(undefined);
  const drawInFlight = useRef(false);
  const skipRequested = useRef(false);
  const openingComplete = useRef(false);
  const [registeredReceiptId, setRegisteredReceiptId] = useState<string>();
  const [drawing, setDrawing] = useState<ShopGradeView>();
  const [pendingCloseMessage, setPendingCloseMessage] = useState<string>();
  const advancePhase = useCallback((next: typeof phase) => { phaseRef.current = next; setPhase(next); }, []);
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
  const selectedAvailability = availability.find((entry) => entry.grade === selected.grade)!;
  const grade = result?.item.grade ?? drawing?.grade ?? selected.grade;
  const baseProfile = profile ?? { badgeId: null, cosmetics: { hat: null, bag: null, prop: null, pose: null, decor: null } };
  const bonusProfile = result?.bonus ? { ...baseProfile, cosmetics: { ...baseProfile.cosmetics, [result.bonus.slot]: result.bonus.id } } : profile;
  const bonusEquipped = !!result?.bonus && profile?.cosmetics[result.bonus.slot] === result.bonus.id;
  const tone = gradeStyle[grade];
  const currentClothing = equippedClothingArt(snapshot);
  const previewClothing = result?.rewards.clothing.item ? equippedClothingArt({ clothing: {
    equipped: result.rewards.clothing.item.id, draw: { probability: result.rewards.clothing.probability },
    items: [{ ...result.rewards.clothing.item, owned: true, equipped: false }],
  } }) : currentClothing;
  const currentReceiptId = receiptId ?? (result ? `${selectedGrade}:${result.item.id}` : selectedGrade);
  const alreadyRegistered = !!result && registeredReceiptId === currentReceiptId;
  const registrationItems = useMemo(() => result ? legacyRegistrationItems(result, ownedBefore, alreadyRegistered) : [], [result, ownedBefore, alreadyRegistered]);

  const startRewardReveal = useCallback((next: GachaRewardPhase | 'result' = 'reward-mileage') => {
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
  }, [advancePhase, cardOpacity, cardScale]);
  const revealNext = useCallback(() => {
    const current = phaseRef.current;
    if (current === 'reward-mileage' || current === 'reward-clothing' || current === 'reward-character') startRewardReveal(gachaNextRewardPhase(current));
  }, [startRewardReveal]);

  useEffect(() => {
    if (!result) return;
    if (consumedResult.current === result) {
      if (activeResult.current === result && phaseRef.current !== 'result' && phaseRef.current !== 'album-registration') {
        drawInFlight.current = false;
        if (!motionAllowed || result.replayed || skipRequested.current || openingComplete.current) {
          skipRequested.current = false;
          const timer = setTimeout(() => {
            if (activeResult.current === result) startRewardReveal('reward-mileage');
          }, 0);
          cardOpacity.set(withTiming(1, { duration: 180 }));
          cardScale.set(1);
          return () => { clearTimeout(timer); };
        }
        if (phaseRef.current !== 'opening') advancePhase('opening');
      }
      return;
    }
    consumedResult.current = result;
    activeResult.current = result;
    if (!motionAllowed || result.replayed || skipRequested.current || openingComplete.current) {
      skipRequested.current = false;
      drawInFlight.current = false;
      const timer = setTimeout(() => {
        if (activeResult.current === result) startRewardReveal('reward-mileage');
      }, 0);
      cardOpacity.set(withTiming(1, { duration: 180 }));
      cardScale.set(1);
      return () => { clearTimeout(timer); };
    }
    drawInFlight.current = false;
    advancePhase('opening');
    void drawHaptic();
  }, [result, motionAllowed, advancePhase, cardOpacity, cardScale, startRewardReveal]);

  const burstStyle = useAnimatedStyle(() => ({ opacity: burst.get(), transform: [{ rotate: `${burst.get() * 35}deg` }, { scale: 0.7 + burst.get() * 0.6 }] }));
  const resultStyle = useAnimatedStyle(() => ({ opacity: cardOpacity.get(), transform: [{ scale: cardScale.get() }] }));

  const finishOpening = useCallback(() => {
    if (phaseRef.current !== 'opening' || openingComplete.current) return;
    openingComplete.current = true;
    setOpeningFinished(true);
    if (!result || activeResult.current !== result) return;
    startRewardReveal('reward-mileage');
  }, [result, startRewardReveal]);

  const startDraw = async (selected: ShopGradeView) => {
    if (drawInFlight.current || busy || refreshing) return;
    drawInFlight.current = true;
    setDrawing(selected);
    skipRequested.current = false;
    openingComplete.current = false;
    setOpeningFinished(false);
    setPendingCloseMessage(undefined);
    activeResult.current = undefined;
    advancePhase('opening');
    burst.set(0);
    cardScale.set(0.55); cardOpacity.set(0);
    const succeeded = await onDraw(selected);
    if (!succeeded) {
      drawInFlight.current = false;
      skipRequested.current = false;
      advancePhase(phaseRef.current === 'opening' ? 'detail' : phaseRef.current);
    }
  };
  const skip = () => {
    if (phaseRef.current === 'opening') {
      skipRequested.current = true;
      finishOpening();
      return;
    }
    const next = gachaPhaseAfter(phaseRef.current, { type: 'skip', busy });
    if (next === 'pending') { skipRequested.current = true; return; }
    if (next === 'detail' || !result) {
      skipRequested.current = false;
      advancePhase('detail');
      return;
    }
    burst.set(1); cardScale.set(1); cardOpacity.set(1); startRewardReveal('reward-mileage');
  };
  const displayPhase = phase;
  const rewardPhase = displayPhase === 'reward-mileage' || displayPhase === 'reward-clothing' || displayPhase === 'reward-character' ? displayPhase : undefined;
  const showResult = !!rewardPhase || displayPhase === 'result' || displayPhase === 'pop';
  const animating = displayPhase === 'opening' && !openingFinished;
  const requestClose = () => {
    if (displayPhase === 'pending' || drawInFlight.current) {
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
          {animating ? <Control label="건너뛰기" onPress={skip} /> : displayPhase === 'pending' || (displayPhase === 'opening' && !result)
            ? <Control label="구매 확인 중" disabled onPress={() => {}} />
            : <Control label="닫기" onPress={onClose} />}
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {displayPhase === 'detail' ? (
            <>
              <Text accessibilityRole="header" style={styles.heading}>{gradeStyle[selected.grade].name} 재뽑기권</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${selected.price.toLocaleString('ko-KR')} 마일리지로 뽑기`}
                accessibilityState={{ disabled: !selectedAvailability.enabled || busy || refreshing }}
                disabled={!selectedAvailability.enabled || busy || refreshing}
                onPress={() => { void startDraw(selected); }}
                style={styles.stageButton}
              >
                <StampDrawStage phase="idle" compact />
              </Pressable>
              <View style={styles.catalog}>{snapshot.items.filter((item) => item.grade === selected.grade).map((item) => <Pressable
                key={item.id} accessibilityRole="button" disabled={item.owned || busy}
                accessibilityState={{ disabled: item.owned || busy, selected: wishId === item.id }}
                accessibilityLabel={`${item.name}, ${item.owned ? '소장' : '미보유'}, 목표로 보기`}
                onPress={() => onWish?.(wishId === item.id ? null : item.id)} style={styles.catalogItem}>
                <CharacterArt avatar={item.id} frame="calm" size={68} /><Text style={styles.catalogName}>{item.name}</Text>
              </Pressable>)}</View>
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
          ) : displayPhase === 'pending' || displayPhase === 'opening' ? (
            <>
              <Text accessibilityRole="header" style={styles.heading}>{displayPhase === 'opening' ? '우표를 여는 중…' : '친구를 만나러 가는 중…'}</Text>
              <View style={styles.stageArea}>{displayPhase === 'opening' && !openingFinished ? <Pressable accessibilityRole="button" accessibilityLabel="연출 건너뛰기" onPress={finishOpening}>
                <StampDrawStage phase="opening" onComplete={finishOpening} />
              </Pressable> : <Text accessibilityLiveRegion="polite" style={styles.description}>뽑기 결과를 확인하고 있어요.</Text>}</View>
              <Text accessibilityLiveRegion="polite" style={styles.description}>뽑기 결과를 확인하고 있어요.</Text>
              {pendingCloseMessage ? <Text accessibilityLiveRegion="polite" style={styles.error}>{pendingCloseMessage}</Text> : null}
            </>
          ) : result && displayPhase === 'album-registration' ? (
            <RegistrationAlbum
              receiptId={currentReceiptId}
              sourceLabel={`${tone.name} 재뽑기권`}
              items={registrationItems}
              onDone={() => { setRegisteredReceiptId(currentReceiptId); advancePhase('result'); }}
              onOpenCollection={onOpenStudio}
              collectionLabel="내 공간에서 보기"
            />
          ) : result ? (
            <>
              <Text accessibilityRole="header" style={styles.heading}>{rewardPhase ? '보상을 하나씩 열어요' : showResult ? result.replayed ? '이전 결과를 확인했어요' : '새 친구를 만났어요!' : '두근두근, 누가 나올까요?'}</Text>
              {!showResult ? <View style={styles.stageArea}><Text accessibilityLiveRegion="polite" style={styles.description}>뽑기 결과를 확인하고 있어요.</Text></View>
                : <View style={styles.resultWrap}>
                {motionAllowed && !result.replayed && !alreadyRegistered ? <Animated.View pointerEvents="none" style={[styles.resultRays, burstStyle]}><BurstRays color={tone.color} /></Animated.View> : null}
                {motionAllowed && !result.replayed && !alreadyRegistered ? <ConfettiBurst colors={[tone.color, tone.pale, '#FFFFFF']} leafColor={tone.color} originX={150} originY={140} width={300} height={360} count={grade === 'GOLD' ? 34 : grade === 'SILVER' ? 22 : 12} /> : null}
                <Animated.View style={[styles.resultCard, { borderColor: tone.color }, resultStyle]} accessible accessibilityLabel={resultAccessibilityLabel(result, rewardPhase)}>
                  <Text style={[styles.gradePill, { backgroundColor: tone.color }]}>{tone.name}</Text>
                  {isNewDraw(result.item, ownedBefore) && (displayPhase === 'reward-character' || displayPhase === 'result') ? <Text style={styles.newBadge}>NEW</Text> : null}
                  {displayPhase === 'reward-mileage' ? <MileageReward amount={result.rewards.mileage.amount} onNext={revealNext} /> : null}
                  {displayPhase === 'reward-clothing' ? <ClothingReward result={result} clothing={previewClothing} profile={bonusProfile} onNext={revealNext} /> : null}
                  {displayPhase === 'reward-character' ? <CharacterReward result={result} clothing={previewClothing} profile={bonusProfile} wished={wishId === result.item.id} onNext={revealNext} /> : null}
                  {displayPhase === 'result' ? <ResultSummary result={result} tone={tone} ownedBefore={ownedBefore} clothing={previewClothing} bonusProfile={bonusProfile} /> : null}
                </Animated.View>
              </View>}
              {displayPhase === 'result' ? <View style={styles.actions}>
                {avatarError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{avatarError}</Text> : null}
                {result.bonus?.slot === 'decor' ? <View style={{ alignItems: 'center', gap: 8 }}>
                  <ThemeOutfitPreview avatar={snapshot.avatar} profile={bonusProfile} />
                  <Text style={styles.description}>참고용 배치 미리보기 · 실제 배치는 내 공간에서 확인해요</Text>
                </View> : null}
                {result.bonus && result.bonus.slot !== 'decor' && profile ? <View style={styles.bonusReveal}>
                  <AvatarPortrait avatar={snapshot.avatar} profile={bonusProfile} clothing={currentClothing} size={104} reaction="idle" />
                  <Text style={[styles.description, styles.ticketCopy]}>지금 동행에게 입혀 본 모습{bonusEquipped ? ' · 장착 완료' : ''}</Text>
                </View> : null}
                {bonusError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{bonusError}</Text> : null}
                {result.bonus && onEquipBonus ? <Control label={bonusSaving ? '꾸미기 저장 중…' : bonusEquipped ? result.bonus?.slot === 'decor' ? '장식 배치 완료' : '꾸미기 장착 완료' : result.bonus?.slot === 'decor' ? '내 공간에 이 장식 배치' : '지금 동행에게 꾸미기 장착'} disabled={avatarBusy || bonusSaving || bonusEquipped} onPress={onEquipBonus} /> : null}
                <Control label={alreadyRegistered ? '등록 결과 다시 보기' : '도감 등록 확인'} primary disabled={avatarBusy || bonusSaving} onPress={() => advancePhase('album-registration')} />
                <Control label={isAvatar ? '대표 캐릭터예요' : avatarBusy ? '설정 중…' : '대표 캐릭터로'} primary disabled={isAvatar || avatarBusy || bonusSaving} onPress={onSetAvatar} />
                {onOpenStudio ? <Control label={result.bonus?.slot === 'decor' ? '내 공간에 놓으러 가기' : '내 공간에서 만나기'} disabled={avatarBusy || bonusSaving} onPress={onOpenStudio} /> : null}
                {canRepeat ? <Control label="한 번 더 뽑기" disabled={avatarBusy || bonusSaving} onPress={() => { activeResult.current = undefined; advancePhase('detail'); }} /> : null}
                <Control label="닫기" onPress={onClose} />
              </View> : null}
            </>
          ) : null}
          {onRecoverPending && displayPhase === 'detail' ? <Control label="이전 구매 결과 다시 확인" disabled={busy || refreshing} onPress={onRecoverPending} /> : null}
          {error ? <View style={styles.errorArea}><Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>
            {onRefresh ? <Control label={refreshing ? '다시 불러오는 중…' : '상점 다시 불러오기'} disabled={busy || refreshing} onPress={onRefresh} /> : null}
          </View> : null}
        </ScrollView>
      </View>
    </FullScreenModal>
  );
}

function legacyRegistrationItems(result: ShopRerollResult, ownedBefore: readonly string[], alreadyRegistered: boolean): RegistrationItem[] {
  const clothing = result.rewards.clothing.item ? [{
    id: `clothing:${result.rewards.clothing.item.id}`,
    name: result.rewards.clothing.item.name,
    kindLabel: '아바타 옷',
    status: registrationStatus(result.replayed || alreadyRegistered, result.rewards.clothing.duplicate),
    detail: alreadyRegistered ? '이번 결과에서 등록 확인을 마쳤어요' : result.rewards.clothing.duplicate ? '이미 가지고 있어요' : undefined,
    artwork: <CosmeticArt id={result.rewards.clothing.item.id} size={86} />,
  } satisfies RegistrationItem] : [];
  return [
    ...clothing,
    {
      id: `character:${result.item.id}`,
      name: result.item.name,
      kindLabel: '캐릭터',
      status: registrationStatus(result.replayed || alreadyRegistered, ownedBefore.includes(result.item.id)),
      detail: alreadyRegistered ? '이번 결과에서 등록 확인을 마쳤어요' : result.replayed || ownedBefore.includes(result.item.id) ? '이미 가지고 있어요' : undefined,
      artwork: <CharacterArt avatar={result.item.id} frame="cheer" size={92} />,
    },
  ];
}

function registrationStatus(replayed: boolean, alreadyOwned: boolean): RegistrationItem['status'] {
  if (replayed) return 'owned';
  return alreadyOwned ? 'duplicate' : 'new';
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

function ClothingReward({ result, clothing, profile, onNext }: { result: ShopRerollResult; clothing: EquippedClothingArt | null; profile?: DisplayExperienceProfile; onNext: () => void }) {
  return <>
    <Text style={styles.rewardKicker}>2 / 3</Text>
    <Text style={styles.rewardTitle}>아바타 옷</Text>
    <View style={styles.clothingPrize}>{result.rewards.clothing.item && clothing ? <AvatarWardrobe clothing={clothing} size={118} /> : <Text style={styles.noPrize}>이번에는 없음</Text>}</View>
    <Text style={styles.characterName}>{result.rewards.clothing.item ? result.rewards.clothing.item.name : '옷 없음'}</Text>
    {result.rewards.clothing.item ? <><AvatarPortrait avatar={result.item.id} profile={profile} clothing={clothing} size={150} reaction="idle" /><Text style={styles.description}>이번 옷 착용 미리보기 · 장착은 내 공간에서 선택해요</Text></> : null}
    {result.rewards.clothing.duplicate ? <Text style={styles.description}>이미 가지고 있어요. 보유 옷은 그대로 유지돼요.</Text> : null}
    <Control label="다음 보상 보기" primary onPress={onNext} />
  </>;
}

function CharacterReward({ result, clothing, profile, wished, onNext }: { result: ShopRerollResult; clothing: EquippedClothingArt | null; profile?: DisplayExperienceProfile; wished?: boolean; onNext: () => void }) {
  return <>
    <Text style={styles.rewardKicker}>3 / 3</Text>
    <Text style={styles.rewardTitle}>새 친구</Text>
    <AvatarPortrait avatar={result.item.id} profile={profile} clothing={clothing} size={240} reaction="cheer" />
    <Text style={styles.characterName}>{result.item.name}</Text>
    <Text style={styles.description}>{wished ? '기다리던 동행을 만났어요!' : '내 공간에서 함께 놀고, 가게를 탐험해요.'}</Text>
    <Control label="최종 결과 보기" primary onPress={onNext} />
  </>;
}

function ResultSummary({ result, tone, ownedBefore, clothing, bonusProfile }: { result: ShopRerollResult; tone: { color: string }; ownedBefore: readonly string[]; clothing: EquippedClothingArt | null; bonusProfile?: DisplayExperienceProfile }) {
  return <>
    {isNewDraw(result.item, ownedBefore) ? <Text style={styles.newBadge}>NEW</Text> : null}
    <Text style={styles.rewardTitle}>최종 결과</Text>
    <Text style={styles.rewardStep}>1. 마일리지 +{result.rewards.mileage.amount}P</Text>
    <Text style={styles.rewardStep}>2. 옷 {result.rewards.clothing.item ? `${result.rewards.clothing.item.name}${result.rewards.clothing.duplicate ? ' (이미 보유)' : ''}` : '이번에는 없음'}</Text>
    <Text style={styles.rewardStep}>3. 캐릭터 {result.item.name}</Text>
    {result.bonus ? <View style={styles.bonusReveal}><CosmeticArt id={result.bonus.id} size={82} /><Text style={styles.rewardStep}>추가 꾸미기 {result.bonus.name}</Text></View> : null}
    <AvatarPortrait avatar={result.item.id} profile={bonusProfile} clothing={clothing} size={150} reaction="cheer" />
    <Text style={[styles.characterName, { color: tone.color }]}>{result.item.name}</Text>
    <Text style={styles.resultBalance}>남은 마일리지 {result.balance.toLocaleString('ko-KR')}P</Text>
  </>;
}

export function BurstRays({ color }: { color: string }) {
  return <Svg width={240} height={240} viewBox="0 0 240 240"><G>{Array.from({ length: 12 }, (_, index) => <Line key={index} x1="120" y1="24" x2="120" y2="5" stroke={color} strokeWidth={index % 2 ? 3 : 6} strokeLinecap="round" transform={`rotate(${index * 30} 120 120)`} />)}</G></Svg>;
}

export function Control({ label, onPress, primary, purchase, disabled }: { label: string; onPress: () => void; primary?: boolean; purchase?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[styles.control, primary && styles.primary, purchase && styles.purchase, disabled && styles.disabled]}><Text style={[styles.controlText, primary && styles.primaryText, purchase && styles.purchaseText]}>{label}</Text></Pressable>;
}

export const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: '#000000', paddingHorizontal: 22 },
  topBar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balance: { color: '#FFE5A4', fontSize: 15, fontWeight: '800' },
  scroll: { flex: 1, minHeight: 0 },
  content: { alignItems: 'center', paddingBottom: 24, gap: 14 },
  heading: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  description: { color: '#D9E7FA', fontSize: 15, textAlign: 'center' },
  catalog: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  catalogItem: { minWidth: 80, alignItems: 'center', padding: 6 },
  catalogName: { color: '#FFFFFF', fontSize: 12, textAlign: 'center' },
  ticketCopy: { flex: 1 },
  ticketNote: { color: '#BED0E6', fontSize: 13 },
  rewardList: { alignSelf: 'stretch', gap: 8, marginVertical: 4 },
  rewardLine: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  rewardStep: { color: '#FFE5A4', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  disabled: { opacity: 0.48 },
  stageArea: { width: '100%', minHeight: 330, alignItems: 'center', justifyContent: 'center' },
  stageButton: { width: '100%', minHeight: 250, alignItems: 'center', justifyContent: 'center' },
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
  bonusReveal: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 10, borderRadius: 14, backgroundColor: '#29473F' },
  resultBalance: { color: '#D9E7FA', fontSize: 14 },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 8 },
  control: { minHeight: 48, minWidth: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#29473F' },
  primary: { backgroundColor: '#FFD579' },
  purchase: { alignSelf: 'stretch', backgroundColor: '#2E8B57', marginTop: 4 },
  controlText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  purchaseText: { color: '#FFFFFF', fontSize: 20 },
  primaryText: { color: '#182942' },
  error: { color: '#FFD1D1', fontSize: 14, textAlign: 'center', marginTop: 4 },
  errorArea: { alignSelf: 'stretch', gap: 8 },
});
