import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, ImageBackground, Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions, type ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gameKinds, type GameAction, type GameKind, type PlayRun } from '../../../../api/src/play-rules';
import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient } from '@/commerce/commerce-api';
import { createPlayApiClient, playErrorMessage, type PlayFinish, type PlaySnapshot } from '@/play/play-api';
import { createShopApiClient } from '@/shop/shop-api';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { BounceButton } from '@/ui/bounce-button';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';
import { Companion, ownedGameArt, type OwnedArt } from './play-art';
import { gameCopy, themeNames } from './play-copy';
import { GameSession } from './game-session';

const roomGoals = [
  { theme: 'daylight', required: 0, image: require('../../../assets/images/play/room-daylight.png') },
  { theme: 'evening', required: 3, image: require('../../../assets/images/play/room-evening.png') },
  { theme: 'garden', required: 10, image: require('../../../assets/images/play/room-garden.png') },
] as const;

function UnlockPreview({ snapshot, label, muted }: { snapshot: PlaySnapshot | undefined; label: string; muted: string }) {
  const { width } = useWindowDimensions();
  const imageSize = Math.floor((width - 40 - 16) / 3);
  const completedRuns = snapshot?.records.reduce((total, record) => total + record.plays, 0);
  return <View style={styles.unlockBand}>
    <Text style={[styles.unlockTitle, { color: label }]}>내 공간 장식{completedRuns === undefined ? '' : ` · ${completedRuns}회 완주`}</Text>
    <View style={styles.roomList}>{roomGoals.map((goal) => {
      const unlocked = goal.required === 0 || snapshot?.unlockedThemes.includes(goal.theme);
      return <View key={goal.theme} style={[styles.roomGoal, { width: imageSize }]}>
        <Image source={goal.image} resizeMode="cover" style={[styles.roomImage, { width: imageSize, height: imageSize }, !unlocked && styles.roomLocked]} accessibilityLabel={`${themeNames[goal.theme]} 미리보기`} />
        <Text style={[styles.roomName, { color: label }]}>{themeNames[goal.theme]}</Text>
        <Text style={[styles.roomRequirement, { color: muted }]}>{unlocked ? '사용 가능' : completedRuns === undefined ? `${goal.required}회 완주` : `${Math.min(completedRuns, goal.required)}/${goal.required}회 완주`}</Text>
      </View>;
    })}</View>
  </View>;
}

export function PlayScreen({ apiUrl, credential, onSessionInvalid }: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>;
}) {
  const palette = colorsForScheme(useColorScheme());
  const insets = useSafeAreaInsets();
  const playApi = useMemo(() => createPlayApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const shopApi = useMemo(() => createShopApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const commerceApi = useMemo(() => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [snapshot, setSnapshot] = useState<PlaySnapshot>();
  const [art, setArt] = useState<OwnedArt[]>([]);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [artLoaded, setArtLoaded] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [selection, setSelection] = useState<GameKind>();
  const [run, setRun] = useState<PlayRun>();
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  const startLock = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setLoadError(undefined);
    const [play, shop, collection] = await Promise.allSettled([
      playApi.getPlay(controller.signal), shopApi.getShop(), commerceApi.getCollection(),
    ]);
    if (controller.signal.aborted) return;
    if (play.status === 'fulfilled') setSnapshot(play.value);
    else setLoadError(playErrorMessage(play.reason));
    if (shop.status === 'fulfilled') { setAvatar(shop.value.avatar); setAvatarLoaded(true); }
    if (collection.status === 'fulfilled') { setArt(ownedGameArt(collection.value)); setArtLoaded(true); }
    setLoading(false);
  }, [playApi, shopApi, commerceApi]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => { active = false; request.current?.abort(); };
  }, [load]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [selection, run?.id]);

  async function start(kind: GameKind) {
    if (startLock.current) return;
    startLock.current = true;
    setSelection(kind);
    setStartBusy(true);
    setStartError(undefined);
    const controller = new AbortController();
    request.current = controller;
    try {
      const issued = await playApi.start(kind, controller.signal);
      if (!controller.signal.aborted) {
        setRun(issued);
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      }
    } catch (caught) {
      if (!controller.signal.aborted) setStartError(playErrorMessage(caught));
    } finally {
      if (!controller.signal.aborted) setStartBusy(false);
      startLock.current = false;
    }
  }

  function applyResult(result: PlayFinish) {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setSnapshot((current) => {
      const records = current?.records.filter((entry) => entry.kind !== result.kind) ?? [];
      const hadRecord = current?.records.some((entry) => entry.kind === result.kind);
      return { records: result.completed || hadRecord ? [...records, { kind: result.kind, bestScore: result.bestScore, plays: result.plays }] : records, unlockedThemes: result.unlockedThemes };
    });
  }

  function exitToHub() {
    setRun(undefined);
    setSelection(undefined);
    void load();
  }

  const record = selection ? snapshot?.records.find((entry) => entry.kind === selection) : undefined;
  const header = run ? <View style={[styles.activeHeader, { paddingTop: insets.top + 8 }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="게임 나가서 놀이 마당으로" onPress={exitToHub} style={styles.activeBack}><Text style={styles.activeBackText}>‹</Text></Pressable>
    <Text style={[styles.activeHeaderTitle, { color: palette.label }]}>놀이 마당</Text>
  </View> : <BackHeader title="놀이 마당" />;
  return <SkyBackdrop><SkyScrollView ref={scrollRef} header={header} contentContainerStyle={styles.content}>
    {run ? <GameSession key={run.id} run={run} art={art} avatar={avatar} previousBest={record?.bestScore}
      onFinish={(issued, actions: readonly GameAction[], signal) => playApi.finish(issued, actions, signal)}
      onResult={applyResult} onRetry={() => { setRun(undefined); void start(run.kind); }}
      onExit={exitToHub} /> : selection ? <>
      <View style={styles.prepHead}>
        <Text style={[styles.eyebrow, { color: gameCopy[selection].color }]}>준비</Text>
        <Text style={[styles.prepTitle, { color: palette.label }]}>{gameCopy[selection].title}</Text>
        <Text style={[styles.rule, { color: palette.secondaryLabel }]}>{gameCopy[selection].rule}</Text>
      </View>
      <View style={styles.prepCompanion}><Companion avatar={avatar} /><Text style={[styles.prepMeta, { color: palette.secondaryLabel }]}>{avatar ? '선택한 동행과 함께' : avatarLoaded ? '동행은 상점에서 고를 수 있어요' : '동행 정보를 확인하지 못했어요'}{record ? ` · 최고 ${record.bestScore.toLocaleString()}점` : ''}</Text></View>
      <UnlockPreview snapshot={snapshot} label={palette.label} muted={palette.secondaryLabel} />
      {startError ? <Text style={[styles.error, { color: palette.error }]}>{startError}</Text> : null}
      <BounceButton label={startBusy ? '시작 준비 중' : '시작하기'} disabled={startBusy} onPress={() => void start(selection)} />
      <BounceButton label="다른 게임" variant="secondary" onPress={() => setSelection(undefined)} />
    </> : <>
      <ImageBackground source={require('../../../assets/images/play/room-daylight.png')} resizeMode="cover" style={styles.hero} imageStyle={styles.heroImage}>
        <View style={styles.heroShade}><Companion avatar={avatar} /><Text style={styles.heroTitle}>오늘은 뭘 해볼까요?</Text></View>
      </ImageBackground>
      {loading && !snapshot ? <StateScene kind="loading" title="놀이 기록을 불러오는 중" /> : null}
      {loadError ? <View style={styles.loadIssue}><Text style={[styles.error, { color: palette.error }]}>{loadError}</Text><BounceButton label="기록 다시 불러오기" variant="secondary" onPress={() => void load()} /></View> : null}
      <View style={styles.gameList}>{gameKinds.map((kind) => {
        const copy = gameCopy[kind];
        const best = snapshot?.records.find((entry) => entry.kind === kind);
        return <Pressable key={kind} accessibilityRole="button" accessibilityLabel={`${copy.title} 준비하기`} onPress={() => setSelection(kind)} style={[styles.gameCard, { borderColor: copy.color, backgroundColor: palette.surface }]}>
          <View style={[styles.gameMark, { backgroundColor: copy.color }]}><Text style={styles.gameMarkText}>{kind === 'stack' ? '▥' : kind === 'memory' ? '◇' : kind === 'delivery' ? '➜' : '☷'}</Text></View>
          <View style={styles.gameDetail}><Text style={[styles.gameTitle, { color: palette.label }]}>{copy.title}</Text><Text style={[styles.gameTag, { color: palette.secondaryLabel }]}>{copy.tag} · {best ? `최고 ${best.bestScore.toLocaleString()}점` : snapshot ? '첫 기록에 도전' : '기록 확인 전'}</Text></View>
          <Text style={[styles.chevron, { color: palette.secondaryLabel }]}>›</Text>
        </Pressable>;
      })}</View>
      <UnlockPreview snapshot={snapshot} label={palette.label} muted={palette.secondaryLabel} />
      {art.length ? <Text style={[styles.ownedNote, { color: palette.secondaryLabel }]}>짝 찾기에 내 수집품 그림 {art.length}개가 나와요.</Text> : <Text style={[styles.ownedNote, { color: palette.secondaryLabel }]}>{artLoaded ? '수집품이 생기면 짝 찾기 카드에 내 그림이 나와요.' : '수집품 그림을 확인하지 못했어요.'}</Text>}
      <Text style={[styles.rewardNote, { color: palette.secondaryLabel }]}>놀이 기록은 공간 장식을 해금해요. 방문 보상이나 마일리지는 가게에서 받아요.</Text>
    </>}
  </SkyScrollView></SkyBackdrop>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 44, gap: 16 },
  activeHeader: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingBottom: 8 },
  activeBack: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#23344E' },
  activeBackText: { color: '#FFF', fontSize: 32, lineHeight: 38 },
  activeHeaderTitle: { fontSize: 18, fontWeight: '800' },
  hero: { height: 190, borderRadius: 7, overflow: 'hidden', justifyContent: 'flex-end' },
  heroImage: { borderRadius: 7 }, heroShade: { minHeight: 80, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 10, backgroundColor: 'rgba(24,49,44,0.63)' },
  heroTitle: { color: '#FFF', fontSize: 22, fontWeight: '900', flexShrink: 1 },
  gameList: { gap: 10 }, gameCard: { minHeight: 80, borderRadius: 7, borderWidth: 2, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  gameMark: { width: 54, height: 54, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, gameMarkText: { color: '#FFF', fontSize: 29, fontWeight: '800' },
  gameDetail: { flex: 1, gap: 4 }, gameTitle: { fontSize: 18, fontWeight: '800' }, gameTag: { fontSize: 13 }, chevron: { fontSize: 27 },
  unlockBand: { gap: 10, paddingVertical: 12, borderTopWidth: 1, borderColor: '#D8E3DE' }, unlockTitle: { fontSize: 16, fontWeight: '800' },
  roomList: { flexDirection: 'row', gap: 8 }, roomGoal: { gap: 4 },
  roomImage: { borderRadius: 6 }, roomLocked: { opacity: 0.58 },
  roomName: { fontSize: 13, fontWeight: '800' }, roomRequirement: { fontSize: 12 },
  ownedNote: { fontSize: 13 }, rewardNote: { fontSize: 13, lineHeight: 19 },
  prepHead: { gap: 12, paddingTop: 14, paddingBottom: 10 }, eyebrow: { fontSize: 14, fontWeight: '800' }, prepTitle: { fontSize: 29, fontWeight: '900' }, rule: { fontSize: 16, lineHeight: 24 },
  prepCompanion: { minHeight: 90, flexDirection: 'row', alignItems: 'center', gap: 12 }, prepMeta: { flex: 1, fontSize: 14 }, error: { fontSize: 14, lineHeight: 20 }, loadIssue: { gap: 10 },
});
