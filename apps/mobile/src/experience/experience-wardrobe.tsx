import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { BadgeArt, CosmeticArt, PackArt } from '@/illustration/artwork';
import { AvatarPortrait } from '@/illustration/avatar-portrait';
import type { EquippedClothingArt } from '@/shop/wardrobe';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { ThemeOutfitPreview } from './theme-pack-board';
import { themeOutfit } from './theme-outfit';
import type { CosmeticSlot, EquipmentPatch, ExperienceProfile, ExperienceSnapshot } from './experience-api';

const slotNames: Record<CosmeticSlot, string> = { hat: '모자', bag: '가방', prop: '소품', pose: '포즈', decor: '공간 장식' };

export function ExperienceWardrobe({ snapshot, saving, onEquip, onWish, avatar, clothing, onPreview }: {
  snapshot: ExperienceSnapshot;
  saving: boolean;
  avatar?: string | null;
  clothing?: EquippedClothingArt | null;
  onPreview?: (profile: ExperienceProfile | null) => void;
  onEquip: (equipment: EquipmentPatch) => void;
  onWish: (itemId: string | null) => void;
}) {
  const router = useRouter();
  const scheme = useColorScheme();
  const styles = makeStyles(colorsForScheme(scheme), worldForScheme(scheme));
  const [preview, setPreview] = useState<{ id: string; profile: ExperienceProfile; avatar: string | null | undefined }>();
  const previewId = preview?.profile === snapshot.profile && preview.avatar === avatar ? preview.id : undefined;
  const previewItem = snapshot.catalog.cosmetics.find((item) => item.id === previewId);
  const previewPack = snapshot.catalog.packs.find((item) => item.id === previewId);
  const outfit = previewPack ? themeOutfit(snapshot, previewPack.id) : undefined;
  const previewBadge = snapshot.catalog.badges.find((item) => item.id === previewId);
  const previewProfile: ExperienceProfile = outfit?.profile ?? { ...snapshot.profile,
    badgeId: previewBadge?.id ?? snapshot.profile.badgeId,
    cosmetics: { ...snapshot.profile.cosmetics, ...(previewItem ? { [previewItem.slot]: previewItem.id } : {}) } };
  const canEquip = outfit ? outfit.canEquip : previewItem ? snapshot.progress.cosmetics.some((item) => item.id === previewItem.id && item.equippable)
    : previewBadge ? snapshot.progress.badges.some((item) => item.id === previewBadge.id && item.owned) : false;
  const alreadyEquipped = outfit ? Object.entries(outfit.cosmetics).every(([slot, id]) => snapshot.profile.cosmetics[slot as CosmeticSlot] === id) : previewItem ? snapshot.profile.cosmetics[previewItem.slot] === previewItem.id
    : previewBadge ? snapshot.profile.badgeId === previewBadge.id : false;
  const select = (id: string, profile: ExperienceProfile) => { setPreview({ id, profile: snapshot.profile, avatar }); onPreview?.(profile); };
  const clear = () => { setPreview(undefined); onPreview?.(null); };
  return <View style={styles.section}>
    <View style={styles.preview}>
      {previewPack || previewItem?.slot === 'decor' ? <ThemeOutfitPreview avatar={avatar ?? null} profile={previewProfile} clothing={clothing} />
        : <AvatarPortrait avatar={avatar ?? null} profile={previewProfile} clothing={clothing} size={156} reaction="idle" />}
      <Text accessibilityLiveRegion="polite" style={styles.optionName}>{previewPack ? `${previewPack.theme} 전체 조합` : previewItem?.name ?? previewBadge?.name ?? '지금 함께하는 동행'}</Text>
      <Text style={styles.intro}>{previewId ? previewPack ? '참고용 미리보기 · 모자·소품·장식을 함께 입혀 봐요' : '미리보기 · 아직 장착을 바꾸지 않았어요' : '그림을 눌러 동행에게 먼저 입혀 보세요'}</Text>
      {previewId ? <View style={styles.options}>
        {canEquip ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving || !!previewPack && alreadyEquipped }} disabled={saving || !!previewPack && alreadyEquipped}
          style={[styles.option, styles.selected]} onPress={() => {
            onEquip(outfit ? { cosmetics: outfit.cosmetics } : previewItem ? { cosmetics: { [previewItem.slot]: alreadyEquipped ? null : previewItem.id } }
              : { badgeId: alreadyEquipped ? null : previewBadge!.id }); clear();
          }}><Text style={styles.optionName}>{saving ? '저장 중…' : previewPack ? alreadyEquipped ? '전체 조합 장착 중' : '이 조합으로 함께 장착' : alreadyEquipped ? '장착 해제' : '이 모습으로 장착'}</Text></Pressable>
          : <Text style={styles.intro}>{previewPack ? '세 꾸미기를 모두 소장하면 함께 장착할 수 있어요' : '해금한 뒤 장착할 수 있어요'}</Text>}
        <Pressable accessibilityRole="button" onPress={clear} style={styles.nextAction}><Text style={styles.nextActionText}>미리보기 닫기</Text></Pressable>
      </View> : null}
    </View>
    <Text accessibilityRole="header" style={styles.heading}>테마 전체 미리보기</Text>
    <Text style={styles.intro}>소장 전에도 조합을 볼 수 있어요. 세 꾸미기를 모두 모으면 한 번에 장착해요.</Text>
    <View style={styles.options}>{snapshot.catalog.packs.map((pack) => {
      const theme = themeOutfit(snapshot, pack.id);
      if (!theme) return null;
      return <Pressable key={pack.id} accessibilityRole="button" disabled={saving}
        accessibilityState={{ selected: previewId === pack.id, disabled: saving }}
        style={[styles.option, previewId === pack.id && styles.selected]}
        onPress={() => select(pack.id, theme.profile)}>
        <PackArt grade={pack.grade} size={64} /><Text style={styles.optionName}>{pack.theme}</Text>
        <Text style={styles.optionDetail}>{theme.canEquip ? '전체 소장 · 조합 입혀 보기' : '미보유 포함 · 참고용 입혀 보기'}</Text>
      </Pressable>;
    })}</View>
    <Text accessibilityRole="header" style={styles.heading}>성취 배지</Text>
    <Text style={styles.intro}>대표 배지는 내 공간과 친구 공간에 함께 보여요.</Text>
    <View style={styles.options}>{snapshot.catalog.badges.map((badge) => {
      const progress = snapshot.progress.badges.find((entry) => entry.id === badge.id);
      const selected = snapshot.profile.badgeId === badge.id;
      return <View key={badge.id} style={styles.badgeGroup}><Pressable accessibilityRole="button" disabled={saving}
        accessibilityState={{ selected: previewId === badge.id, disabled: saving }}
        onPress={() => select(badge.id, { ...snapshot.profile, badgeId: badge.id })}
        style={[styles.option, selected && styles.selected, !progress?.owned && styles.locked]}>
        <BadgeArt id={badge.id} size={64} /><Text style={styles.optionName}>{badge.name}{selected ? ' · 장착' : ''}</Text>
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
        return <View key={item.id} style={styles.badgeGroup}><Pressable accessibilityRole="button" disabled={saving}
          accessibilityState={{ selected: previewId === item.id, disabled: saving }}
          onPress={() => select(item.id, { ...snapshot.profile, cosmetics: { ...snapshot.profile.cosmetics, [slot]: item.id } })}
          style={[styles.option, selected && styles.selected, !progress?.equippable && styles.locked]}>
          <CosmeticArt id={item.id} size={76} /><Text style={styles.optionName}>{item.name}{selected ? ' · 장착' : ''}</Text>
          <Text style={styles.optionDetail}>{progress?.equippable ? selected ? '장착 중 · 눌러서 미리보기' : '소장 · 눌러서 미리보기' : `${source}에서 해금${badgeProgress ? ` · ${badgeProgress.value}/${badgeProgress.target}` : packProgress ? ` · ${packProgress.ownedBonuses}/${packProgress.totalBonuses}` : ''}`}</Text>
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

const makeStyles = (palette: ReturnType<typeof colorsForScheme>, world: ReturnType<typeof worldForScheme>) => StyleSheet.create({
  preview: { alignItems: 'center', gap: 8, paddingBottom: 12 },
  section: { backgroundColor: world.card, borderColor: palette.separator, borderWidth: 1, borderRadius: 12, padding: 14, gap: 9 },
  heading: { color: world.cardInk, fontSize: 17, fontWeight: '900', marginTop: 4 },
  intro: { color: world.cardMuted, fontSize: 12 },
  group: { gap: 6 },
  slot: { color: world.cardInk, fontSize: 13, fontWeight: '800' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  option: { alignItems: 'center', minWidth: 124, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: palette.separator, backgroundColor: world.paper },
  selected: { borderColor: palette.primary, backgroundColor: palette.primaryContainer },
  locked: { borderStyle: 'dashed' },
  optionName: { color: world.cardInk, fontSize: 13, fontWeight: '800' },
  optionDetail: { color: world.cardMuted, fontSize: 12, marginTop: 2 },
  badgeGroup: { gap: 2, flexGrow: 1, maxWidth: '100%' },
  nextAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 7, paddingVertical: 4 }, nextActionText: { color: palette.primary, fontSize: 12, fontWeight: '800' },
});
