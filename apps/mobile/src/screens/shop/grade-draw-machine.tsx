import { useEffect, useRef, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cancelAnimation, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { consentRecheckLabel, consentRequiredMessage } from '@/privacy/consent-flow';
import { RegistrationAlbum, type RegistrationItem } from '@/acquisition/registration-album';
import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { ConfettiBurst } from '@/gamification/confetti';
import { drawHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { playUiSound, useDrawMusic } from '@/sound/ui-sounds';
import { CharacterArt } from '@/illustration/character-art';
import { CosmeticArt, PackArt } from '@/illustration/artwork';
import { classifyGradeDrawCoinAcquisition } from '@/shop/coin-acquisition';
import type { GradeDrawPool, GradeDrawResult, GradeReward } from '@/shop/grade-draw-api';
import { BurstRays, Control, Machine, gradeStyle, styles } from './gacha-machine';

type Props = { pool: GradeDrawPool; balance: number; result?: GradeDrawResult; busy: boolean; error?: string;
  refreshing?: boolean; equipmentBusy?: boolean; equipmentError?: string; avatarId?: string | null; equippedThemeId?: string | null;
  onDraw: () => Promise<boolean>; onRecover?: () => void; onRecheckConsent?: () => void; onEquip?: () => void;
  onOpenCollection: (focus?: { publicationId: string; gradeId: string; receiptId: string }) => void;
  onClose: () => void; onRefresh: () => void };

const kindName: Record<GradeReward['kind'], string> = { COIN: '가게 코인', THEME: '테마 꾸미기', CHARACTER: '캐릭터' };

export function GradeDrawMachine({ pool, balance, result, busy, error, refreshing, equipmentBusy, equipmentError,
  avatarId, equippedThemeId, onDraw, onRecover, onRecheckConsent, onEquip, onOpenCollection, onClose, onRefresh }: Props) {
  const insets = useSafeAreaInsets();
  const motionAllowed = useMotionEnabled();
  useDrawMusic();
  const [phase, setPhase] = useState<'detail' | 'pending' | 'opening' | 'result' | 'album-registration'>('detail');
  const [closeNotice, setCloseNotice] = useState(false);
  const [registeredDrawId, setRegisteredDrawId] = useState<string>();
  const seen = useRef<GradeDrawResult | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const jiggle = useSharedValue(0);
  const crank = useSharedValue(0);
  const openingScale = useSharedValue(0.8);
  const machineStyle = useAnimatedStyle(() => ({ transform: [{ scale: openingScale.get() }] }));
  const crankStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${crank.get()}deg` }] }));
  const tone = gradeStyle[result?.grade ?? pool.grade];

  useEffect(() => {
    if (!result) return;
    if (seen.current === result) {
      const resume = setTimeout(() => setPhase('result'), 0);
      return () => clearTimeout(resume);
    }
    seen.current = result;
    if (result.replayed || !motionAllowed) {
      const replay = setTimeout(() => setPhase('result'), 0);
      return () => clearTimeout(replay);
    }
    const enter = setTimeout(() => setPhase('opening'), 0);
    crank.set(withTiming(360, { duration: 540 }));
    jiggle.set(withSequence(withTiming(-1, { duration: 100 }), withTiming(1, { duration: 100 }),
      withTiming(-1, { duration: 100 }), withTiming(1, { duration: 100 }), withTiming(0, { duration: 100 })));
    openingScale.set(withSequence(withTiming(1.06, { duration: 500 }), withTiming(1, { duration: 280 })));
    playUiSound('open'); void drawHaptic();
    timer.current = setTimeout(() => { setPhase('result'); playUiSound('success'); void drawHaptic(); }, 850);
    return () => { clearTimeout(enter); if (timer.current) clearTimeout(timer.current); };
  }, [result, motionAllowed, crank, jiggle, openingScale]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); cancelAnimation(crank); cancelAnimation(jiggle); cancelAnimation(openingScale); }, [crank, jiggle, openingScale]);

  const start = async () => {
    if (busy || !pool.total || balance < pool.price) return;
    setCloseNotice(false);
    crank.set(0); jiggle.set(0); openingScale.set(0.8);
    setPhase('pending');
    if (!await onDraw()) setPhase('detail');
  };
  const close = () => {
    if (phase === 'pending' || busy) { setCloseNotice(true); return; }
    onClose();
  };
  const displayedBalance = result?.balance ?? balance;
  const reward = result?.reward;
  const showResult = phase === 'result' && !!reward;
  const registrationItem = result && reward ? gradeRegistrationItem(result, registeredDrawId === result.drawId) : undefined;
  const alreadyRegistered = !!result && registeredDrawId === result.drawId;
  return <FullScreenModal visible animationType="fade" onRequestClose={close}>
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.topBar}>
        <Text style={styles.balance}>보유 {displayedBalance.toLocaleString('ko-KR')} 마일리지</Text>
        {phase === 'opening' ? <Control label="연출 건너뛰기" onPress={() => { if (timer.current) clearTimeout(timer.current); setPhase('result'); }} />
          : <Control label="닫기" disabled={phase === 'pending' || busy} onPress={close} />}
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {phase === 'detail' ? <>
          <Text accessibilityRole="header" style={styles.heading}>{tone.name} 전체 랜덤</Text>
          <PackArt grade={pool.grade} size={170} />
          <Text style={styles.description}>같은 등급의 코인·테마 꾸미기·캐릭터 중 정확히 하나를 받아요.</Text>
          <Text style={styles.description}>코인 {pool.counts.COIN}종 · 꾸미기 {pool.counts.THEME}종 · 캐릭터 {pool.counts.CHARACTER}종</Text>
          <Text style={styles.description}>전체 {pool.total}종, 품목마다 1/{pool.total} (약 {(pool.probabilityPerItem * 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%) · 이미 가진 것도 다시 나올 수 있어요.</Text>
          <View style={styles.catalog}>{pool.rewards.map((entry) => <View key={`${entry.kind}:${entry.id}`} style={styles.catalogItem}>
            <RewardArt reward={entry} size={62} /><Text style={styles.catalogName}>{kindName[entry.kind]} · {entry.name}</Text>
          </View>)}</View>
          {balance < pool.price ? <Text style={styles.error}>마일리지 {(pool.price - balance).toLocaleString('ko-KR')}P 부족</Text> : null}
          <Control label={`${pool.price.toLocaleString('ko-KR')} 마일리지로 뽑기`} purchase disabled={busy || refreshing || !pool.total || balance < pool.price} onPress={() => { void start(); }} />
          {onRecover ? <Control label="이전 뽑기 결과 다시 확인" disabled={busy || refreshing} onPress={onRecover} /> : null}
        </> : phase === 'pending' || phase === 'opening' ? <>
          <Text accessibilityRole="header" style={styles.heading}>{phase === 'pending' ? '뽑기 결과 확인 중…' : '캡슐을 여는 중…'}</Text>
          <Machine tone={tone} machineStyle={machineStyle} crankStyle={crankStyle} jiggle={jiggle} />
          {phase === 'pending' ? <Text accessibilityLiveRegion="polite" style={styles.description}>요청을 확인하고 있어요.</Text> : null}
          {closeNotice ? <Text style={styles.error}>구매 확인이 끝나면 닫을 수 있어요.</Text> : null}
        </> : phase === 'album-registration' && result && reward && registrationItem ? <>
          <RegistrationAlbum
            receiptId={result.drawId}
            sourceLabel={`${tone.name} 전체 랜덤`}
            items={[registrationItem]}
            onDone={() => { setRegisteredDrawId(result.drawId); setPhase('result'); }}
            onOpenCollection={reward.kind === 'COIN' ? () => onOpenCollection({ publicationId: reward.publicationId, gradeId: reward.gradeId, receiptId: result.drawId }) : undefined}
            collectionLabel={reward.kind === 'COIN' ? '코인 도감에서 보기' : undefined}
          />
        </> : showResult ? <>
          <Text accessibilityRole="header" style={styles.heading}>이번 뽑기 결과</Text>
          {motionAllowed && !result.replayed && !alreadyRegistered ? <BurstRays color={tone.color} /> : null}
          {motionAllowed && !result.replayed && !alreadyRegistered ? <ConfettiBurst colors={[tone.color, tone.pale, '#FFFFFF']} leafColor={tone.color} originX={140} originY={130} width={280} height={250} count={pool.grade === 'GOLD' ? 32 : 18} /> : null}
          <View accessible accessibilityLabel={`${tone.name} ${kindName[reward.kind]} ${reward.name}${reward.kind === 'COIN' ? `, ${publicDataDemoStoreName(reward.merchantId, reward.merchantName)}` : ''}${result.duplicate ? ' 중복' : ''}`} style={[styles.resultCard, { borderColor: tone.color }]}>
            <Text style={[styles.gradePill, { backgroundColor: tone.color }]}>{tone.name} · {kindName[reward.kind]}</Text>
            <RewardArt reward={reward} size={170} />
            <Text style={styles.characterName}>{reward.name}</Text>
            {reward.kind === 'COIN' ? <Text style={styles.description}>{publicDataDemoStoreName(reward.merchantId, reward.merchantName)} · 보유 {result.quantity}개</Text> : null}
            <Text style={styles.description}>{result.replayed ? '이전 뽑기 결과를 다시 확인했어요.' : result.duplicate ? '이미 가진 보상이 다시 나왔어요.' : '새 보상을 받았어요.'}</Text>
            <Text style={styles.resultBalance}>남은 마일리지 {result.balance.toLocaleString('ko-KR')}P</Text>
          </View>
          {equipmentError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{equipmentError}</Text> : null}
          <Control label={alreadyRegistered ? '등록 결과 다시 보기' : '도감 등록 확인'} primary disabled={equipmentBusy} onPress={() => setPhase('album-registration')} />
          {reward.kind === 'COIN' ? <Control label="코인 도감 보기" onPress={() => onOpenCollection({ publicationId: reward.publicationId, gradeId: reward.gradeId, receiptId: result.drawId })} /> : null}
          {reward.kind === 'CHARACTER' && onEquip ? <Control label={avatarId === reward.id ? '동행 설정 완료' : equipmentBusy ? '설정 중…' : '동행으로 설정'} primary disabled={equipmentBusy || avatarId === reward.id} onPress={onEquip} /> : null}
          {reward.kind === 'THEME' && onEquip ? <Control label={equippedThemeId === reward.id ? '꾸미기 장착 완료' : equipmentBusy ? '설정 중…' : '지금 꾸미기 장착'} primary disabled={equipmentBusy || equippedThemeId === reward.id} onPress={onEquip} /> : null}
          <Control label="다른 등급 보기" disabled={equipmentBusy} onPress={() => { seen.current = undefined; setPhase('detail'); onClose(); }} />
          <Control label="닫기" disabled={equipmentBusy} onPress={close} />
        </> : null}
        {error ? <View style={styles.errorArea}><Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>
          {error === consentRequiredMessage && onRecheckConsent
            ? <Control label={consentRecheckLabel} primary onPress={onRecheckConsent} />
            : <Control label={refreshing ? '다시 불러오는 중…' : '상점 다시 불러오기'} disabled={busy || refreshing} onPress={onRefresh} />}
        </View> : null}
      </ScrollView>
    </View>
  </FullScreenModal>;
}

function gradeRegistrationItem(result: GradeDrawResult, alreadyRegistered: boolean): RegistrationItem {
  const reward = result.reward;
  const status: RegistrationItem['status'] = alreadyRegistered ? 'owned' : classifyGradeDrawCoinAcquisition(result);
  const detail = reward.kind === 'COIN'
    ? `${publicDataDemoStoreName(reward.merchantId, reward.merchantName)} · 보유 ${result.quantity}개`
    : status === 'new' ? undefined : alreadyRegistered ? '이번 결과에서 등록 확인을 마쳤어요' : '이미 가지고 있어요';
  return {
    id: `${reward.kind}:${reward.id}`,
    name: reward.name,
    kindLabel: kindName[reward.kind],
    status,
    detail,
    artwork: <RewardArt reward={reward} size={92} />,
  };
}

function RewardArt({ reward, size }: { reward: GradeReward; size: number }) {
  if (reward.kind === 'CHARACTER') return <CharacterArt avatar={reward.id} frame="cheer" size={size} />;
  if (reward.kind === 'THEME') return <CosmeticArt id={reward.id} size={size} />;
  return reward.artwork ? <Image source={{ uri: reward.artwork.thumbnailDataUrl }} style={{ width: size, height: size }} accessibilityLabel={reward.name} />
    : <Text style={{ fontSize: Math.min(size * 0.6, 72) }} accessibilityLabel={reward.name}>🪙</Text>;
}
