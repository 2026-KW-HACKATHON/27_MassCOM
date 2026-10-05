import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CosmeticSlot, EquipmentPatch, ExperienceSnapshot } from './experience-api';

const slotNames: Record<CosmeticSlot, string> = { hat: '모자', bag: '가방', prop: '소품', pose: '포즈', decor: '공간 장식' };

export function ExperienceWardrobe({ snapshot, saving, onEquip, onWish }: {
  snapshot: ExperienceSnapshot;
  saving: boolean;
  onEquip: (equipment: EquipmentPatch) => void;
  onWish: (itemId: string | null) => void;
}) {
  const router = useRouter();
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>성취 배지</Text>
    <Text style={styles.intro}>대표 배지는 내 공간과 친구 공간에 함께 보여요.</Text>
    <View style={styles.options}>{snapshot.catalog.badges.map((badge) => {
      const progress = snapshot.progress.badges.find((entry) => entry.id === badge.id);
      const selected = snapshot.profile.badgeId === badge.id;
      return <View key={badge.id} style={styles.badgeGroup}><Pressable accessibilityRole="button" disabled={saving || !progress?.owned}
        accessibilityState={{ selected, disabled: !progress?.owned }}
        onPress={() => onEquip({ badgeId: selected ? null : badge.id })}
        style={[styles.option, selected && styles.selected, !progress?.owned && styles.locked]}>
        <Text style={styles.optionName}>{badge.kind === 'game' ? '★' : '✦'} {badge.name}{selected ? ' · 장착' : ''}</Text>
        <Text style={styles.optionDetail}>{progress?.owned ? `${badge.unlockItemIds.length}개 꾸미기 해금` :
          progress ? `${progress.value}/${progress.target} · ${progress.nextAction}` : '진행 정보를 확인 중'}</Text>
      </Pressable>{!progress?.owned && progress ? <Pressable accessibilityRole="button"
        onPress={() => router.push(badge.kind === 'game' ? '/play' : '/map')} style={styles.nextAction}>
        <Text style={styles.nextActionText}>{badge.kind === 'game' ? '게임에 도전하기' : '가게 탐색하기'} ›</Text>
      </Pressable> : null}</View>;
    })}</View>
    <Text accessibilityRole="header" style={styles.heading}>동행 꾸미기</Text>
    {(['hat', 'bag', 'prop', 'pose', 'decor'] as const).map((slot) => <View key={slot} style={styles.group}>
      <Text style={styles.slot}>{slotNames[slot]}</Text>
      <View style={styles.options}>{snapshot.catalog.cosmetics.filter((item) => item.slot === slot).map((item) => {
        const progress = snapshot.progress.cosmetics.find((entry) => entry.id === item.id);
        const selected = snapshot.profile.cosmetics[slot] === item.id;
        const origin = item.source;
        const source = origin.kind === 'badge'
          ? snapshot.catalog.badges.find((badge) => badge.id === origin.badgeId)?.name ?? '배지'
          : snapshot.catalog.packs.find((pack) => pack.id === origin.packId)?.name ?? '테마팩';
        const badgeProgress = origin.kind === 'badge' ? snapshot.progress.badges.find((entry) => entry.id === origin.badgeId) : undefined;
        const packProgress = origin.kind === 'pack' ? snapshot.progress.packs.find((entry) => entry.id === origin.packId) : undefined;
        return <View key={item.id} style={styles.badgeGroup}><Pressable accessibilityRole="button" disabled={saving || !progress?.equippable}
          accessibilityState={{ selected, disabled: !progress?.equippable }}
          onPress={() => onEquip({ cosmetics: { [slot]: selected ? null : item.id } })}
          style={[styles.option, selected && styles.selected, !progress?.equippable && styles.locked]}>
          <Text style={styles.optionName}>{item.name}{selected ? ' · 장착' : ''}</Text>
          <Text style={styles.optionDetail}>{progress?.equippable ? '눌러서 장착하기' : `${source}에서 해금${badgeProgress ? ` · ${badgeProgress.value}/${badgeProgress.target}` : packProgress ? ` · ${packProgress.ownedBonuses}/${packProgress.totalBonuses}` : ''}`}</Text>
        </Pressable>{!progress?.equippable ? <Pressable accessibilityRole="button" disabled={saving}
          onPress={() => onWish(snapshot.profile.wishlist === item.id ? null : item.id)} style={styles.nextAction}>
          <Text style={styles.nextActionText}>{snapshot.profile.wishlist === item.id ? '목표 해제' : '갖고 싶은 꾸미기로 저장'}</Text>
        </Pressable> : null}{!progress?.equippable ? <Pressable accessibilityRole="button"
          onPress={() => router.push(origin.kind === 'pack' ? '/shop' : snapshot.catalog.badges.find((badge) => badge.id === origin.badgeId)?.kind === 'game' ? '/play' : '/map')}
          style={styles.nextAction}><Text style={styles.nextActionText}>획득하러 가기 ›</Text></Pressable> : null}</View>;
      })}</View>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  section: { backgroundColor: '#FFFFFF', borderColor: '#DBE3EC', borderWidth: 1, borderRadius: 12, padding: 14, gap: 9 },
  heading: { color: '#192331', fontSize: 17, fontWeight: '900', marginTop: 4 },
  intro: { color: '#58677D', fontSize: 12 },
  group: { gap: 6 },
  slot: { color: '#3E526B', fontSize: 13, fontWeight: '800' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  option: { minWidth: 128, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: '#CCD8E6', backgroundColor: '#F9FBFF' },
  selected: { borderColor: '#2456D6', backgroundColor: '#EAF1FF' },
  locked: { opacity: 0.67 },
  optionName: { color: '#243A55', fontSize: 12, fontWeight: '800' },
  optionDetail: { color: '#58677D', fontSize: 10, marginTop: 2 },
  badgeGroup: { gap: 2 },
  nextAction: { paddingHorizontal: 7, paddingVertical: 4 }, nextActionText: { color: '#2456D6', fontSize: 10, fontWeight: '800' },
});
