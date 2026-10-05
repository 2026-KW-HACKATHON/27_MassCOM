import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, Pressable, Text, View, useColorScheme, useWindowDimensions, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabGlyph } from '../navigation/tab-glyph';
import { uiMetrics } from '../theme/ui-metrics';
import { worldForScheme } from '../theme/world';
import { AvatarWardrobe, type EquippedClothingArt } from '@/shop/wardrobe';
import { mascotArt } from './mascot-art';
import { SkyArt } from './sky-art';
import { skyArtHeight } from './sky-art-size';
import { useUiStyles } from './use-ui-styles';
import { isLargeText } from './large-text';

type Props = {
  title: string;
  subtitle?: string;
  /** Hero content that sits on the art under the title (a mascot, a chip); the art is always fully shown. */
  children?: ReactNode;
  /** The avatar picture; defaults to the mascot badge. Only the home tab passes the chosen 상점 캐릭터 (design-298.md). */
  avatarArt?: ImageSourcePropType;
  /** The equipped shop clothing drawn over the account avatar when available. */
  avatarClothing?: EquippedClothingArt | null;
  avatarContent?: ReactNode;
  /** Adds a second pill linking to `/friends` (design-298.md: 친구 moved out of the tab bar into the home header). */
  showFriendsEntry?: boolean;
  /** Adds the home mailbox entry; the mailbox route is provided by the social/mail lane. */
  showMailEntry?: boolean;
};

/**
 * Top of a tab screen's scroll content: the sky art, the title on a frosted panel, and the account avatar with its "내 정보" label (outside the panel).
 * `/settings` (계정 삭제·로그아웃) stays one tap away. Put it first inside the ScrollView / list so it scrolls away with the page.
 */
export function AppHeader({ title, subtitle, children, avatarArt, avatarClothing, avatarContent, showFriendsEntry, showMailEntry }: Props) {
  const styles = useUiStyles();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const largeText = isLargeText(fontScale);
  const stackedHeader = largeText || (showFriendsEntry && width < 360);
  const world = worldForScheme(useColorScheme());
  return (
    <View style={{ minHeight: skyArtHeight(width), marginBottom: 8 }}>
      <SkyArt />
      <View
        style={{
          flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12,
          paddingHorizontal: uiMetrics.pageInset, paddingTop: insets.top + 8, paddingBottom: 12,
        }}
      >
        <View style={[styles.headerPanel, { flex: 1 }, stackedHeader && { flexBasis: '100%' }]}>
          <Text accessibilityRole="header" style={styles.headerTitle}>{title}</Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
        {showMailEntry ? (
          <Link href="/mail" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="우편" hitSlop={{ left: 8, right: 8 }} style={styles.avatarButton}>
              <View style={styles.avatarIconPill}>
                <TabGlyph name="mail" color={world.skyInk} size={26} />
              </View>
              <View accessible={false} style={styles.avatarLabelPill}>
                <Text maxFontSizeMultiplier={1.3} style={styles.avatarLabel}>우편</Text>
              </View>
            </Pressable>
          </Link>
        ) : null}
        {showFriendsEntry ? (
          <Link href="/friends" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="친구" hitSlop={{ left: 8, right: 8 }} style={styles.avatarButton}>
              <View style={styles.avatarIconPill}>
                <TabGlyph name="friends" color={world.skyInk} size={26} />
              </View>
              <View accessible={false} style={[styles.avatarLabelPill, largeText && { marginHorizontal: 0 }]}>
                <Text style={styles.avatarLabel}>친구</Text>
              </View>
            </Pressable>
          </Link>
        ) : null}
        <Link href="/settings" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={avatarClothing ? `내 정보, ${avatarClothing.name} 착용` : '내 정보'}
            hitSlop={{ left: 8, right: 8 }}
            style={styles.avatarButton}
          >
            {avatarContent ?? <View style={{ position: 'relative', width: 44, height: 44 }}>
              <Image source={avatarArt ?? mascotArt['logo-badge']} style={{ width: 44, height: 44 }} accessible={false} />
              <View pointerEvents="none" style={{ position: 'absolute', left: 8, top: 17 }}>
                <AvatarWardrobe clothing={avatarClothing ?? null} size={28} />
              </View>
            </View>}
            {/* The avatar alone does not say "your account"; the label sits on its own frosted pill so it reads over the art. */}
            <View accessible={false} style={[styles.avatarLabelPill, largeText && { marginHorizontal: 0 }]}>
              <Text style={styles.avatarLabel}>내 정보</Text>
            </View>
          </Pressable>
        </Link>
      </View>
      {children ? <View style={{ paddingHorizontal: uiMetrics.pageInset, paddingBottom: 12 }}>{children}</View> : null}
    </View>
  );
}
