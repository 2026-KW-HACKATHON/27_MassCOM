import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, Pressable, Text, View, useColorScheme, useWindowDimensions, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabGlyph } from '../navigation/tab-glyph';
import { uiMetrics } from '../theme/ui-metrics';
import { worldForScheme } from '../theme/world';
import { mascotArt } from './mascot-art';
import { SkyArt } from './sky-art';
import { skyArtHeight } from './sky-art-size';
import { useUiStyles } from './use-ui-styles';

type Props = {
  title: string;
  subtitle?: string;
  /** Hero content that sits on the art under the title (a mascot, a chip); the art is always fully shown. */
  children?: ReactNode;
  /** The avatar picture; defaults to the mascot badge. Only the home tab passes the chosen 상점 캐릭터 (design-298.md). */
  avatarArt?: ImageSourcePropType;
  avatarContent?: ReactNode;
  /** Adds a second pill linking to `/friends` (design-298.md: 친구 moved out of the tab bar into the home header). */
  showFriendsEntry?: boolean;
};

/**
 * Top of a tab screen's scroll content: the sky art, the title on a frosted panel, and the account avatar with its "내 정보" label (outside the panel).
 * `/settings` (계정 삭제·로그아웃) stays one tap away. Put it first inside the ScrollView / list so it scrolls away with the page.
 */
export function AppHeader({ title, subtitle, children, avatarArt, avatarContent, showFriendsEntry }: Props) {
  const styles = useUiStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const world = worldForScheme(useColorScheme());
  return (
    <View style={{ minHeight: skyArtHeight(width), marginBottom: 8 }}>
      <SkyArt />
      <View
        style={{
          flexDirection: 'row', alignItems: 'flex-start', gap: 12,
          paddingHorizontal: uiMetrics.pageInset, paddingTop: insets.top + 8, paddingBottom: 12,
        }}
      >
        <View style={[styles.headerPanel, { flex: 1 }]}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} style={styles.headerTitle}>{title}</Text>
          {/* 큰 글자에서도 부제를 숨기지 않는다 — 대신 줄바꿈한다(PR #312 QA: 2.0배에서 사라지던 문제). 줄 수를
              제한하지 않아 Text가 원래 하듯 자유롭게 줄바꿈하고, 제목과 같은 1.6배로만 더 커지는 것을 막는다. */}
          {subtitle ? <Text maxFontSizeMultiplier={1.6} style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
        {showFriendsEntry ? (
          <Link href="/friends" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="친구" hitSlop={{ left: 8, right: 8 }} style={styles.avatarButton}>
              <View style={styles.avatarIconPill}>
                <TabGlyph name="friends" color={world.skyInk} size={26} />
              </View>
              <View accessible={false} style={styles.avatarLabelPill}>
                <Text maxFontSizeMultiplier={1.3} style={styles.avatarLabel}>친구</Text>
              </View>
            </Pressable>
          </Link>
        ) : null}
        <Link href="/settings" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="내 정보" hitSlop={{ left: 8, right: 8 }} style={styles.avatarButton}>
            {avatarContent ?? <Image source={avatarArt ?? mascotArt['logo-badge']} style={{ width: 44, height: 44 }} />}
            {/* The avatar alone does not say "your account"; the label sits on its own frosted pill so it reads over the art. */}
            <View accessible={false} style={styles.avatarLabelPill}>
              <Text maxFontSizeMultiplier={1.3} style={styles.avatarLabel}>내 정보</Text>
            </View>
          </Pressable>
        </Link>
      </View>
      {children ? <View style={{ paddingHorizontal: uiMetrics.pageInset, paddingBottom: 12 }}>{children}</View> : null}
    </View>
  );
}
