import { useRouter } from 'expo-router';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiMetrics } from '../theme/ui-metrics';
import { SkyArt } from './sky-art';
import { compactArtHeight } from './sky-art-size';
import { useUiStyles } from './use-ui-styles';

/**
 * Top of a page reached from the header avatar or a list rather than a tab: compact sky art, a round back button and the title
 * on a frosted panel. Put it first inside the ScrollView so it scrolls away with the page.
 */
export function BackHeader({ title }: { title: string }) {
  const styles = useUiStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  return (
    <View style={{ minHeight: compactArtHeight(width), marginBottom: 8 }}>
      <SkyArt compact />
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
        <View style={[styles.headerPanel, { flexShrink: 1 }]}>
          <Text accessibilityRole="header" style={styles.backTitle}>{title}</Text>
        </View>
      </View>
    </View>
  );
}
