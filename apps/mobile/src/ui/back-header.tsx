import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { uiMetrics } from '../theme/ui-metrics';
import { playUiSound } from '../sound/ui-sounds';
import { StoreArt } from './store-art';
import { ProfileStrip } from './profile-strip';
import { useUiStyles } from './use-ui-styles';

type Props = { title: string; art?: ImageSourcePropType; artNote?: string; onArtError?: () => void;
  onBack?: () => void; children?: ReactNode };
export function BackHeader({ title, art, artNote, onArtError, onBack, children }: Props) {
  const styles = useUiStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return <View style={{ paddingTop: insets.top + 8, paddingBottom: 12 }}>
    <ProfileStrip />
    {art ? <StoreArt source={art} height={180} note={artNote} onError={onArtError} /> : null}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: uiMetrics.pageInset, paddingTop: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={() => {
        playUiSound('close'); if (onBack) onBack(); else if (router.canGoBack()) router.back(); else router.replace('/');
      }} style={styles.backButton}><Text accessible={false} maxFontSizeMultiplier={1.2} style={styles.backGlyph}>‹</Text></Pressable>
      <Text accessibilityRole="header" style={[styles.backTitle, { flex: 1 }]}>{title}</Text>
    </View>
    {children ? <View style={{ paddingHorizontal: uiMetrics.pageInset, paddingTop: 12 }}>{children}</View> : null}
  </View>;
}
