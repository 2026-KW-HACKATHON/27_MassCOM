import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View, useWindowDimensions, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiMetrics } from '../theme/ui-metrics';
import { SkyArt } from './sky-art';
import { compactArtHeight, storeArtHeight } from './sky-art-size';
import { StoreArt } from './store-art';
import { useUiStyles } from './use-ui-styles';

type Props = {
  title: string;
  /** A store picture to use as the banner instead of the town sky (the showcase merchants have one). */
  art?: ImageSourcePropType;
  /** Caption over the picture; only drawn with `art`. */
  artNote?: string;
  /** Called when the store picture fails to load, so the page can stop passing it (the header then shows the sky art). */
  onArtError?: () => void;
  /** Where the back button goes when the page is not a router screen (the showcase owner pages replace the whole navigator). */
  onBack?: () => void;
  /** Hero content under the title (a mascot, a chip), same slot AppHeader gives a tab screen. */
  children?: ReactNode;
};

/**
 * Top of a page reached from the header avatar or a list rather than a tab: compact sky art (or the store's own picture), a round
 * back button and the title on a frosted panel. Put it first inside the ScrollView so it scrolls away with the page.
 */
export function BackHeader({ title, art, artNote, onArtError, onBack, children }: Props) {
  const styles = useUiStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const height = art ? storeArtHeight(width) : compactArtHeight(width);
  return (
    <View style={{ minHeight: height, marginBottom: 8 }}>
      {art ? <StoreArt source={art} height={height} note={artNote} onError={onArtError} /> : <SkyArt compact />}
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingHorizontal: uiMetrics.pageInset, paddingTop: insets.top + 8, paddingBottom: 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
          style={styles.backButton}
        >
          <Text accessible={false} maxFontSizeMultiplier={1.2} style={styles.backGlyph}>‹</Text>
        </Pressable>
        <View style={[styles.headerPanel, { flexShrink: 1 }]}>
          <Text accessibilityRole="header" style={styles.backTitle}>{title}</Text>
        </View>
      </View>
      {children ? <View style={{ paddingHorizontal: uiMetrics.pageInset, paddingBottom: 12 }}>{children}</View> : null}
    </View>
  );
}
