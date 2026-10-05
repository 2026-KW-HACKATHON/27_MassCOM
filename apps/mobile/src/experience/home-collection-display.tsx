import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View, useColorScheme, type ImageSourcePropType } from 'react-native';

import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { ShopSnapshot } from '@/shop/shop-api';
import type { resolveStudioGoal } from '@/studio/studio-goals';
import { CompanionScene, StudioCoin } from '@/studio/studio-scene';
import { BadgeArt, PackArt } from '@/illustration/artwork';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import type { ExperienceSnapshot } from './experience-api';

export function HomeCollectionDisplay({ experience, collection, shop, visitGoal, apiUrl }: {
  experience: ExperienceSnapshot;
  collection?: CollectionSnapshot;
  shop?: ShopSnapshot;
  avatarArt?: ImageSourcePropType;
  visitGoal?: ReturnType<typeof resolveStudioGoal>;
  apiUrl: string;
}) {
  const router = useRouter();
  const scheme = useColorScheme();
  const styles = makeStyles(colorsForScheme(scheme), worldForScheme(scheme));
  const badge = experience.catalog.badges.find((item) => item.id === experience.profile.badgeId);
  const coin = collection?.collectibles.find((item) => item.entitlementId === experience.profile.coinEntitlementId);
  const availablePacks = experience.catalog.packs.filter((pack) => !shop ||
    (shop.grades.find((grade) => grade.grade === pack.grade)?.remaining ?? 0) > 0);
  const nextPack = availablePacks.find((pack) => shop && shop.mileage.balance >= pack.price) ?? availablePacks[0];
  const packProgress = experience.progress.packs.find((item) => item.id === nextPack?.id);
  const wantedCharacter = shop?.items.find((item) => item.id === experience.profile.wishlist);
  const wantedCosmetic = experience.catalog.cosmetics.find((item) => item.id === experience.profile.wishlist);
  return <View style={styles.card}>
    <View style={styles.titleRow}><Text accessibilityRole="header" style={styles.title}>나의 탐험 전시</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/studio')}><Text style={styles.link}>꾸미기 ›</Text></Pressable></View>
    <View style={styles.showcase}>
      <CompanionScene avatar={shop?.avatar ?? null} experienceProfile={experience.profile} interactive size={132} />
      <View style={styles.details}>
        {badge ? <View style={styles.badgeLine}><BadgeArt id={badge.id} size={42} /><Text style={styles.detail}>{badge.name}</Text></View> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={coin ? `${coin.displayName} 도감에서 보기` : "대표 코인 고르기"} onPress={() => router.push('/collection')} style={styles.coinLine}>{coin ? <StudioCoin item={coin} apiUrl={apiUrl} size={108} /> : null}
          <Text style={styles.detail}>{coin ? coin.displayName : '대표 코인을 골라 보세요'}</Text></Pressable>
      </View>
    </View>
    {nextPack ? <Pressable accessibilityRole="button" onPress={() => router.push('/shop')} style={styles.pack}>
      <PackArt grade={nextPack.grade} size={64} /><View style={styles.packCopy}><Text style={styles.packTitle}>{nextPack.name}</Text>
        <Text style={styles.packHint}>{nextPack.theme} · 꾸미기 {packProgress?.ownedBonuses ?? 0}/{packProgress?.totalBonuses ?? nextPack.bonusItemIds.length}</Text>
        <Text style={styles.packHint}>{shop ? `${nextPack.price} 마일리지 · 보유 ${shop.mileage.balance}` : `${nextPack.price} 마일리지`}</Text></View>
      <Text style={styles.packArrow}>열어보기 ›</Text>
    </Pressable> : null}
    {wantedCharacter || wantedCosmetic ? <Pressable accessibilityRole="button" onPress={() => router.push(wantedCharacter ? '/shop' : '/studio')} style={styles.inbox}>
      <Text style={styles.inboxText}>갖고 싶은 것 · {wantedCharacter?.name ?? wantedCosmetic?.name} {wantedCharacter?.owned || experience.progress.cosmetics.find((item) => item.id === wantedCosmetic?.id)?.owned ? '소장 완료' : '획득 방법 보기'} ›</Text>
    </Pressable> : null}
    {visitGoal?.goal?.merchantId ? <Pressable accessibilityRole="button"
      onPress={() => visitGoal.status === 'active' ? router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: visitGoal.goal.merchantId! } }) : router.push('/studio')} style={styles.inbox}>
      <Text style={styles.inboxText}>{visitGoal.status === 'active' ? `다음 방문 목표 · ${visitGoal.label}` : `${visitGoal.status === 'completed' ? '목표 달성' : '목표 다시 고르기'} · ${visitGoal.label}`}</Text>
      {visitGoal.status !== 'active' ? <Text style={styles.inboxText}>{visitGoal.next ? `${visitGoal.next.label} · 새 목표 고르기` : '새 목표 고르기'} ›</Text> : null}
    </Pressable> : null}
    <Pressable accessibilityRole="button" onPress={() => router.push('/notifications' as Href)} style={styles.inbox}>
      <Text style={styles.inboxText}>방문·쿠폰 알림함 보기 ›</Text>
    </Pressable>
  </View>;
}

const makeStyles = (palette: ReturnType<typeof colorsForScheme>, world: ReturnType<typeof worldForScheme>) => StyleSheet.create({
  card: { marginHorizontal: 14, padding: 14, gap: 10, backgroundColor: world.card, borderRadius: 14, borderWidth: 1, borderColor: palette.separator },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: world.cardInk, fontWeight: '900', fontSize: 17 },
  link: { color: palette.primary, fontWeight: '800', fontSize: 12 },
  showcase: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 156 },
  details: { flex: 1, minWidth: 124, gap: 6 },
  detail: { color: world.cardInk, fontWeight: '700', fontSize: 12 },
  badgeLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coinLine: { alignItems: 'center', gap: 4 },
  pack: { flexWrap: 'wrap', borderRadius: 11, padding: 11, backgroundColor: world.paper, borderWidth: 1, borderColor: world.paperLine, flexDirection: 'row', alignItems: 'center', gap: 8 },
  packCopy: { flex: 1 }, packTitle: { color: world.paperInk, fontWeight: '900', fontSize: 13 },
  packHint: { color: world.paperInk, fontSize: 11, marginTop: 2 }, packArrow: { color: world.paperInk, fontSize: 11, fontWeight: '900' },
  inbox: { alignSelf: 'flex-start', paddingVertical: 4 }, inboxText: { color: palette.primary, fontSize: 12, fontWeight: '800' },
});
