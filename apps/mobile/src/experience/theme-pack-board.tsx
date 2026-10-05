import { StyleSheet, Text, View } from 'react-native';

import type { ExperienceSnapshot } from './experience-api';

export function ThemePackBoard({ snapshot }: { snapshot: ExperienceSnapshot }) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>테마 꾸미기</Text>
    <Text style={styles.intro}>테마 팩을 열면 해당 등급의 미보유 캐릭터와 미보유 꾸미기 1개가 확정돼요. 모자 → 소품 → 장식 순서로 세 번 열면 테마를 완성해요. 모은 꾸미기는 내 공간에서 장착해요.</Text>
    {snapshot.catalog.packs.map((pack) => {
      const progress = snapshot.progress.packs.find((item) => item.id === pack.id);
      const names = pack.bonusItemIds.map((id) => snapshot.catalog.cosmetics.find((item) => item.id === id)?.name).filter(Boolean);
      return <View key={pack.id} style={styles.pack}>
        <Text style={styles.name}>{pack.name} · {{ BRONZE: '브론즈', SILVER: '실버', GOLD: '골드' }[pack.grade]} 캐릭터</Text>
        <Text style={styles.description}>{pack.theme} · {names.join(' · ')}</Text>
        <Text style={styles.progress}>{progress ? `${progress.ownedBonuses}/${progress.totalBonuses}개 소장 · ${progress.opens}번 열었어요` : '진행 정보를 확인 중'}</Text>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginHorizontal: 14, padding: 14, borderRadius: 12, borderColor: '#E2D3A9', borderWidth: 1, backgroundColor: '#FFFAEB', gap: 9 },
  heading: { color: '#5D401C', fontWeight: '900', fontSize: 17 },
  intro: { color: '#705C41', fontSize: 12, lineHeight: 18 },
  pack: { borderTopWidth: 1, borderColor: '#E9D9B3', paddingTop: 8 },
  name: { color: '#5D401C', fontWeight: '800', fontSize: 13 },
  description: { color: '#705C41', fontSize: 11, marginTop: 3 },
  progress: { color: '#92622D', fontSize: 11, fontWeight: '700', marginTop: 3 },
});
