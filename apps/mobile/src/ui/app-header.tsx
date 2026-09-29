import { Link } from 'expo-router';
import { Image, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiMetrics } from '../theme/ui-metrics';
import { mascotArt } from './mascot-art';
import { useUiStyles } from './use-ui-styles';

type Props = { title: string; subtitle?: string };

/** Screen title on a frosted panel over the sky art, plus the account avatar (outside the panel); `/settings` (계정 삭제·로그아웃) stays one tap away. */
export function AppHeader({ title, subtitle }: Props) {
  const styles = useUiStyles();
  const insets = useSafeAreaInsets();
  return (
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
  );
}
