import { Image, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { CosmeticArt, PackArt } from '@/illustration/artwork';
import { AvatarPortrait } from '@/illustration/avatar-portrait';
import type { EquippedClothingArt } from '@/shop/wardrobe';
import { StudioDecor } from '@/studio/studio-scene';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import type { DisplayExperienceProfile, ExperienceSnapshot } from './experience-api';

export function ThemePackBoard({ snapshot }: { snapshot: ExperienceSnapshot }) {
  const scheme = useColorScheme();
  const styles = makeStyles(colorsForScheme(scheme), worldForScheme(scheme));
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>테마 꾸미기</Text>
    <Text style={styles.intro}>등급별 전체 랜덤 뽑기에서 코인·테마 꾸미기·캐릭터 중 하나가 나와요. 꾸미기도 중복될 수 있으며, 모은 꾸미기는 내 공간에서 장착해요.</Text>
    {snapshot.catalog.packs.map((pack) => {
      const progress = snapshot.progress.packs.find((item) => item.id === pack.id);

      return <View key={pack.id} style={styles.pack}>
        <PackArt grade={pack.grade} size={100} /><Text style={styles.name}>{pack.name} · {{ BRONZE: '브론즈', SILVER: '실버', GOLD: '골드' }[pack.grade]} 테마</Text>
        <Text style={styles.description}>{pack.theme} · {pack.price.toLocaleString('ko-KR')} 마일리지</Text>
        <View style={styles.rewards}>{pack.bonusItemIds.map((id) => <View key={id} style={styles.reward}><CosmeticArt id={id} size={54} /><Text style={styles.description}>{snapshot.catalog.cosmetics.find((item) => item.id === id)?.name}</Text></View>)}</View><Text style={styles.progress}>{progress ? `${progress.ownedBonuses}/${progress.totalBonuses}개 소장 · 이 등급 ${progress.opens}회 뽑기` : '진행 정보를 확인 중'}</Text>
      </View>;
    })}
  </View>;
}

/** A local reference room: no visits, collectible records or equipment are created. */
export function ThemeOutfitPreview({ avatar, profile, clothing }: { avatar: string | null; profile?: DisplayExperienceProfile; clothing?: EquippedClothingArt | null }) {
  return <View style={{ width: 264, maxWidth: '100%', height: 200, overflow: 'hidden', borderRadius: 14 }}>
    <Image source={require('../../assets/images/play/room-daylight.png')} resizeMode="cover" accessible={false}
      style={{ position: 'absolute', width: '100%', height: '100%' }} />
    {profile?.cosmetics.decor ? <StudioDecor id={profile.cosmetics.decor} width={264} height={200} /> : null}
    <View pointerEvents="none" style={{ position: 'absolute', left: 124, bottom: 30, width: 72, height: 10, borderRadius: 36, backgroundColor: '#584B3D24' }} />
    <View style={{ position: 'absolute', left: 96, bottom: 34, width: 128, height: 128 }}>
      <AvatarPortrait avatar={avatar} profile={profile} clothing={clothing} size={128} reaction="idle" animated={false} />
    </View>
  </View>;
}

const makeStyles = (palette: ReturnType<typeof colorsForScheme>, world: ReturnType<typeof worldForScheme>) => StyleSheet.create({
  section: { marginHorizontal: 14, padding: 14, borderRadius: 12, borderColor: world.paperLine, borderWidth: 1, backgroundColor: world.paper, gap: 9 },
  heading: { color: world.paperInk, fontWeight: '900', fontSize: 17 },
  intro: { color: world.paperInk, fontSize: 12, lineHeight: 18 },
  rewards: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, reward: { alignItems: 'center', flex: 1, minWidth: 70 },
  pack: { borderTopWidth: 1, borderColor: world.paperLine, paddingTop: 8 },
  name: { color: world.paperInk, fontWeight: '800', fontSize: 13 },
  description: { color: world.paperInk, fontSize: 12, marginTop: 3 },
  progress: { color: world.paperInk, fontSize: 12, fontWeight: '700', marginTop: 3 },
});
