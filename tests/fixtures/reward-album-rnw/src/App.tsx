import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RegistrationAlbum, type RegistrationItem } from '../../../../apps/mobile/src/acquisition/registration-album';
import { GradeDrawMachine } from '../../../../apps/mobile/src/screens/shop/grade-draw-machine';
import { GachaMachine } from '../../../../apps/mobile/src/screens/shop/gacha-machine';
import type { GradeDrawPool, GradeDrawResult } from '../../../../apps/mobile/src/shop/grade-draw-api';
import type { ShopRerollResult, ShopSnapshot } from '../../../../apps/mobile/src/shop/shop-api';
import coinThumbnail from '../../../../apps/mobile/assets/images/collectibles/showcase-a.png';
import { CoinReveal } from '../../../../apps/mobile/src/screens/coin-shop/coin-reveal';
import { CollectionScenario } from './CollectionScenario';
import { HomeScenario } from './HomeScenario';

function coinArt(label: string, tone: string) {
  return (
    <View style={[coinStyles.coin, { borderColor: tone, backgroundColor: `${tone}22` }]}>
      <Text style={[coinStyles.coinMark, { color: tone }]}>{label}</Text>
    </View>
  );
}

const coinStyles = StyleSheet.create({
  coin: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinMark: { fontSize: 34, lineHeight: 40, fontWeight: '900' },
});

const albumItems: RegistrationItem[] = [
  {
    id: 'coin:alpha:gold',
    name: '월계시장 금빛 코인',
    kindLabel: '가게 코인',
    status: 'new',
    detail: '처음 얻은 GOLD 등급',
    artwork: coinArt('G', '#B98517'),
  },
  {
    id: 'theme:mint-window',
    name: '민트 창가 꾸미기',
    kindLabel: '테마 꾸미기',
    status: 'duplicate',
    detail: '이미 가지고 있어요',
    artwork: coinArt('T', '#076F64'),
  },
  {
    id: 'character:walk-rabbit',
    name: '골목 산책 친구',
    kindLabel: '캐릭터',
    status: 'owned',
    detail: '복구된 결과로 확인했어요',
    artwork: coinArt('C', '#2456D6'),
  },
];

const gradePool: GradeDrawPool = {
  grade: 'GOLD',
  price: 500,
  version: 'qa-pool-v1',
  total: 3,
  probabilityPerItem: 1 / 3,
  counts: { COIN: 1, THEME: 1, CHARACTER: 1 },
  rewards: [
    {
      kind: 'COIN',
      id: 'coin-woolgye-gold',
      publicationId: 'pub-woolgye',
      gradeId: 'gold',
      merchantId: 'demo-merchant',
      merchantName: '월계시장 분식',
      name: '분식집 금빛 코인',
      artwork: { thumbnailDataUrl: coinThumbnail },
    },
    { kind: 'THEME', id: 'mint-window', slot: 'decor', name: '민트 창가' },
    { kind: 'CHARACTER', id: 'walk-rabbit', name: '골목 산책 친구' },
  ],
};

const gradeResult: GradeDrawResult = {
  drawId: 'qa-grade-draw-001',
  grade: 'GOLD',
  price: 500,
  reward: gradePool.rewards[0]!,
  duplicate: false,
  quantity: 1,
  balance: 1500,
  replayed: false,
};

const shopSnapshot: ShopSnapshot = {
  mileage: { earned: 4400, spent: 1200, balance: 3200, showcaseBonus: 0, rules: { visit: 100, newStore: 200, series: 300 } },
  grades: [
    { grade: 'BRONZE', price: 100, total: 2, owned: 1, remaining: 1, probabilityPerItem: 0.5 },
    { grade: 'SILVER', price: 300, total: 2, owned: 1, remaining: 1, probabilityPerItem: 0.5 },
    { grade: 'GOLD', price: 500, total: 2, owned: 0, remaining: 2, probabilityPerItem: 0.5 },
  ],
  items: [
    { id: 'walk-rabbit', grade: 'GOLD', name: '골목 산책 친구', owned: false },
    { id: 'cook-cat', grade: 'GOLD', name: '따뜻한 요리 친구', owned: false },
    { id: 'cafe-bear', grade: 'SILVER', name: '카페 동행', owned: true },
  ],
  avatar: 'cafe-bear',
  clothing: {
    equipped: null,
    draw: { probability: 0.35 },
    items: [
      { id: 'gold-hat', name: '금빛 모자', owned: false, equipped: false },
      { id: 'straw-hat', name: '햇살 모자', owned: true, equipped: false },
    ],
  },
  drawRewards: {
    bonusMileage: { min: 20, max: 60, probabilityPerAmount: 1 / 41 },
  },
};

const rerollResult: ShopRerollResult = {
  item: { id: 'walk-rabbit', grade: 'GOLD', name: '골목 산책 친구' },
  bonus: { id: 'gold-hat', name: '금빛 모자', slot: 'hat' },
  balance: 2700,
  replayed: false,
  rewards: {
    mileage: { amount: 45, min: 20, max: 60, probabilityPerAmount: 1 / 41 },
    clothing: { awarded: true, duplicate: false, item: { id: 'gold-hat', name: '금빛 모자' }, probability: 0.35 },
    sequence: ['MILEAGE', 'CLOTHING', 'CHARACTER'],
  },
};

function scenarioName(): 'album' | 'grade' | 'gacha' | 'coin' | 'collection' | 'home' {
  const value = new URLSearchParams(window.location.search).get('scenario');
  return value === 'grade' || value === 'gacha' || value === 'coin' || value === 'collection' || value === 'home' ? value : 'album';
}

export function App() {
  const scenario = scenarioName();
  const [route, setRoute] = useState('');
  useEffect(() => {
    const record = (event: Event) => setRoute(JSON.stringify((event as CustomEvent).detail));
    window.addEventListener('reward-album-router-push', record);
    return () => window.removeEventListener('reward-album-router-push', record);
  }, []);
  return (
    <View style={styles.app}>
      {route ? <Text>QA 이동 요청: {route}</Text> : null}
      {scenario === 'album' ? <AlbumScenario /> : null}
      {scenario === 'grade' ? <GradeScenario /> : null}
      {scenario === 'gacha' ? <GachaScenario /> : null}
      {scenario === 'coin' ? <CoinScenario /> : null}
      {scenario === 'collection' ? <CollectionScenario /> : null}
      {scenario === 'home' ? <HomeScenario /> : null}
    </View>
  );
}

function CoinScenario() {
  const [done, setDone] = useState(false);
  const params = new URLSearchParams(window.location.search);
  return <ScrollView contentContainerStyle={styles.albumPage}>
    <Text style={styles.fixtureTitle}>가게 코인 연출 QA · 합성 결과</Text>
    {done ? <Text>수동 확인 완료</Text> : <CoinReveal sourceLabel="QA 음식점 · 방문 기념" gradeId={params.get('rarity') ?? 'prism'} recovered={params.get('recovered') === '1'}>
      <Text accessibilityRole="header">코인을 받았어요</Text>
      <Image source={{ uri: coinThumbnail }} style={{ width: 160, height: 160, alignSelf: 'center' }} />
      <Text>QA 코인 · 총 1개 · 신규</Text>
      <Text>QA 음식점 · 방문 기념</Text>
      <Pressable accessibilityRole="button" onPress={() => setDone(true)} style={{ minHeight: 48, padding: 12 }}><Text>확인하고 다음으로</Text></Pressable>
    </CoinReveal>}
  </ScrollView>;
}

function AlbumScenario() {
  const [doneCount, setDoneCount] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  return (
    <ScrollView contentContainerStyle={styles.albumPage}>
      <Text accessibilityRole="header" style={styles.fixtureTitle}>획득 결과 QA</Text>
      <RegistrationAlbum
        receiptId="direct-album-001"
        sourceLabel="월계시장 상자 보상"
        items={albumItems}
        onDone={() => setDoneCount((count) => count + 1)}
        onOpenCollection={() => setOpenCount((count) => count + 1)}
        collectionLabel="도감에서 보기"
      />
      <View style={styles.eventLog}>
        <Text style={styles.eventLogText}>확인 완료 호출 {doneCount}회</Text>
        <Text style={styles.eventLogText}>도감 이동 호출 {openCount}회</Text>
      </View>
    </ScrollView>
  );
}

function GradeScenario() {
  return (
    <GradeDrawMachine
      pool={gradePool}
      balance={2000}
      result={gradeResult}
      busy={false}
      onDraw={async () => true}
      onOpenCollection={() => window.dispatchEvent(new CustomEvent('reward-album-open-collection', { detail: 'grade' }))}
      onClose={() => window.dispatchEvent(new CustomEvent('reward-album-close', { detail: 'grade' }))}
      onRefresh={() => undefined}
    />
  );
}

function GachaScenario() {
  const profile = useMemo(() => ({ badgeId: null, cosmetics: { hat: null, bag: null, prop: null, pose: null, decor: null } }), []);
  return (
    <GachaMachine
      snapshot={shopSnapshot}
      profile={profile}
      result={rerollResult}
      receiptId="qa-reroll-001"
      selectedGrade="GOLD"
      ownedBefore={[]}
      busy={false}
      avatarBusy={false}
      isAvatar={false}
      onDraw={async () => true}
      onSetAvatar={() => window.dispatchEvent(new CustomEvent('reward-album-set-avatar'))}
      onClose={() => window.dispatchEvent(new CustomEvent('reward-album-close', { detail: 'gacha' }))}
      onOpenStudio={() => window.dispatchEvent(new CustomEvent('reward-album-open-studio'))}
    />
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, minHeight: '100vh' as unknown as number, backgroundColor: '#F1F5ED' },
  albumPage: { padding: 16, gap: 14 },
  fixtureTitle: { color: '#163D46', fontSize: 20, lineHeight: 28, fontWeight: '900' },
  eventLog: { padding: 12, gap: 4, borderRadius: 14, backgroundColor: '#FFFFFF' },
  eventLogText: { color: '#48646A', fontSize: 13, lineHeight: 18, fontWeight: '700' },
});

export default App;
