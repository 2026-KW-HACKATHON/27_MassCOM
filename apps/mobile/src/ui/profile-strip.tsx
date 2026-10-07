import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions, type ImageSourcePropType } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { subscribeProfileUpdates } from '@/friends/profile-updates';
import { createFriendsApiClient } from '@/friends/friends-api';
import { createShopApiClient, type ShopSnapshot } from '@/shop/shop-api';
import { friendArt } from '@/shop/shop-art';
import { equippedClothingArt, AvatarWardrobe, type EquippedClothingArt } from '@/shop/wardrobe';
import { createSocialApiClient } from '@/social/social-api';
import { TabGlyph } from '@/navigation/tab-glyph';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { mascotArt } from './mascot-art';

type Snapshot = { nickname?: string; intro?: string; shop?: ShopSnapshot; unread?: number };
export function ProfileStrip({ avatarArt, avatarClothing, avatarContent }: {
  avatarArt?: ImageSourcePropType; avatarClothing?: EquippedClothingArt | null; avatarContent?: ReactNode;
}) {
  const auth = useAuthSession();
  const scheme = useColorScheme();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.5;
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const credential = auth.credential;
  const clients = useMemo(() => {
    if (!credential || !publicApiConfig.available) return null;
    const options = { apiUrl: publicApiConfig.apiUrl, credential, onSessionInvalid: auth.invalidateSession };
    return { friends: createFriendsApiClient(options), shop: createShopApiClient(options), social: createSocialApiClient(options) };
  }, [credential, auth.invalidateSession]);
  const [loaded, setLoaded] = useState<{ clients: typeof clients; value: Snapshot }>();
  useFocusEffect(useCallback(() => {
    let current = true;
    let generation = 0;
    const load = () => {
      const request = ++generation;
      if (clients) void Promise.allSettled([clients.friends.getFriends(), clients.shop.getShop(), clients.social.getSocial()]).then(([friends, shop, social]) => {
      if (current && request === generation) setLoaded({ clients, value: {
        ...(friends.status === 'fulfilled' ? { nickname: friends.value.me.nickname, intro: friends.value.me.intro } : {}),
        ...(shop.status === 'fulfilled' ? { shop: shop.value } : {}),
        ...(social.status === 'fulfilled' ? { unread: social.value.unreadMailCount } : {}),
      } });
    });
    };
    load();
    const unsubscribe = subscribeProfileUpdates(load);
    return () => { current = false; unsubscribe(); };
  }, [clients]));
  if (!credential) return null;
  const data = loaded?.clients === clients ? loaded?.value : undefined;
  const art = avatarArt ?? (data?.shop?.avatar ? friendArt[data.shop.avatar] : undefined) ?? mascotArt['logo-badge'];
  const clothing = avatarClothing ?? equippedClothingArt(data?.shop);
  return <View style={[styles.row, largeText && { flexWrap: 'wrap' }]}>
    <Link href="/profile" asChild><Pressable accessibilityRole="button" accessibilityLabel="내 프로필과 한 줄 소개 편집" style={StyleSheet.flatten([styles.identity, largeText && { flexBasis: '100%' }])}>
      {avatarContent ?? <View style={styles.avatar}><Image source={art} style={styles.avatar} accessible={false} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 8, top: 17 }}><AvatarWardrobe clothing={clothing} size={28} /></View>
      </View>}
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: world.skyInk, fontSize: 15, fontWeight: '800' }}>{data?.nickname ?? '내 프로필'}</Text>
        <Text numberOfLines={1} style={{ color: world.skyMuted, fontSize: 12, lineHeight: 17 }}>{data?.intro || '한 줄 소개를 적어 보세요'} ✎</Text>
      </View>
    </Pressable></Link>
    <Link href="/shop" asChild><Pressable accessibilityRole="button" accessibilityLabel={data?.shop ? `마일리지 ${data.shop.mileage.balance} 포인트, 상점` : '마일리지 조회, 상점'}
      style={StyleSheet.flatten([styles.mileage, { backgroundColor: palette.accentContainer }])}>
      <Text style={{ color: palette.onAccentContainer, fontSize: 13, fontWeight: '800' }}>Ⓟ {data?.shop ? data.shop.mileage.balance.toLocaleString('ko-KR') : '—'}</Text>
    </Pressable></Link>
    <Link href="/mail" asChild><Pressable accessibilityRole="button" accessibilityLabel={data?.unread ? `우편, 읽지 않은 우편 ${data.unread}개` : '우편'} style={styles.action}>
      <TabGlyph name="mail" color={world.skyInk} size={25} />
      {data?.unread ? <View style={[styles.dot, { backgroundColor: palette.error }]} /> : null}
    </Pressable></Link>
    <Link href="/settings" asChild><Pressable accessibilityRole="button" accessibilityLabel="설정" style={styles.action}>
      <Svg accessible={false} width={25} height={25} viewBox="0 0 24 24" fill="none">
        <Path d="m9 3 1-2h4l1 2 2 1 2-1 2 3-1 2v3l2 1-1 4-2 1-1 2v2h-4l-2-1-2 1H6l-1-3-2-1v-4l1-2V8L3 6l3-3 2 1Z" stroke={world.skyInk} strokeWidth="1.5" strokeLinejoin="round" />
        <Circle cx="12" cy="11" r="3.5" stroke={world.skyInk} strokeWidth="1.8" />
      </Svg>
    </Pressable></Link>
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingBottom: 8 },
  identity: { flexDirection: 'row', alignItems: 'center', flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, gap: 6, minHeight: 48 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  action: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  mileage: { paddingHorizontal: 10, minHeight: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 6, right: 7, width: 8, height: 8, borderRadius: 4 },
});
