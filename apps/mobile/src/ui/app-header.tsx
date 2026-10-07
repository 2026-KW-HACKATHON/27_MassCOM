import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View, useColorScheme, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabGlyph } from '../navigation/tab-glyph';
import { worldForScheme } from '../theme/world';
import type { EquippedClothingArt } from '@/shop/wardrobe';
import { ProfileStrip } from './profile-strip';
import { useUiStyles } from './use-ui-styles';

type Props = { title: string; subtitle?: string; children?: ReactNode; avatarArt?: ImageSourcePropType;
  avatarClothing?: EquippedClothingArt | null; avatarContent?: ReactNode; showFriendsEntry?: boolean; showMailEntry?: boolean; compact?: boolean };

/** One account strip, followed by a compact page heading so map/game content has room. */
export function AppHeader({ title, subtitle, children, avatarArt, avatarClothing, avatarContent, showFriendsEntry, compact }: Props) {
  const insets = useSafeAreaInsets();
  const styles = useUiStyles();
  const world = worldForScheme(useColorScheme());
  return <View style={{ paddingTop: insets.top + 8, paddingBottom: compact ? 4 : 12 }}>
    <ProfileStrip avatarArt={avatarArt} avatarClothing={avatarClothing} avatarContent={avatarContent} />
    {title !== '홈' ? <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 3, flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ flex: 1 }}><Text accessibilityRole="header" style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}</View>
      {showFriendsEntry ? <Link href="/friends" asChild><Pressable accessibilityRole="button" accessibilityLabel="친구" style={styles.avatarButton}>
        <TabGlyph name="friends" color={world.skyInk} size={26} /><Text style={styles.avatarLabel}>친구</Text>
      </Pressable></Link> : null}
    </View> : null}
    {children ? <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>{children}</View> : null}
  </View>;
}
