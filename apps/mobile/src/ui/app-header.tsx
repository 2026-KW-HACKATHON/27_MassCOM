import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiMetrics } from '../theme/ui-metrics';
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
 * Top of a tab screen's scroll content: the sky art, the title on a frosted panel, and the account avatar (outside the panel).
 * `/settings` (계정 삭제·로그아웃) stays one tap away. Put it first inside the ScrollView / list so it scrolls away with the page.
 */
export function AppHeader({ title, subtitle, children }: Props) {
  const styles = useUiStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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
          <Text accessibilityRole="header" style={styles.headerTitle}>{title}</Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
        <Link href="/settings" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="내 정보" style={styles.avatarButton}>
            <Image source={mascotArt['logo-badge']} style={{ width: 44, height: 44 }} />
          </Pressable>
        </Link>
      </View>
      {children ? <View style={{ paddingHorizontal: uiMetrics.pageInset, paddingBottom: 12 }}>{children}</View> : null}
    </View>
  );
}
