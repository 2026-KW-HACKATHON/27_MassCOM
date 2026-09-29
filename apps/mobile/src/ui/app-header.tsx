import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiMetrics } from '../theme/ui-metrics';
import { isLargeText } from './large-text';
import { mascotArt } from './mascot-art';
import { SkyArt } from './sky-art';
import { skyArtHeight } from './sky-art-size';
import { useUiStyles } from './use-ui-styles';

type Props = {
  title: string;
  subtitle?: string;
  /** Hero content that sits on the art under the title (a mascot, a chip); the art is always fully shown. */
  children?: ReactNode;
};

/**
 * Top of a tab screen's scroll content: the sky art, the title on a frosted panel, and the account avatar with its "내 정보" label (outside the panel).
 * `/settings` (계정 삭제·로그아웃) stays one tap away. Put it first inside the ScrollView / list so it scrolls away with the page.
 */
export function AppHeader({ title, subtitle, children }: Props) {
  const styles = useUiStyles();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  // At 150% text and up the subtitle goes: the title and the hero carry the screen, and the header must not fill the first page.
  const large = isLargeText(fontScale);
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
          {subtitle && !large ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
        <Link href="/settings" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="내 정보" hitSlop={{ left: 8, right: 8 }} style={styles.avatarButton}>
            <Image source={mascotArt['logo-badge']} style={{ width: 44, height: 44 }} />
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
