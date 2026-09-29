import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiMetrics } from '../theme/ui-metrics';
import { useUiStyles } from './use-ui-styles';

/** Page title on the sky with a round back button; for pages reached from the header avatar rather than a tab. */
export function BackHeader({ title }: { title: string }) {
  const styles = useUiStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: uiMetrics.pageInset, paddingTop: insets.top + 8, paddingBottom: 12,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="뒤로"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={styles.backButton}
      >
        <Text accessible={false} maxFontSizeMultiplier={1.2} style={styles.backGlyph}>‹</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.backTitle}>{title}</Text>
    </View>
  );
}
