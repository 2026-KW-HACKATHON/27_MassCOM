import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useDiscovery } from '@/discovery/discovery-provider';
import { colorsForScheme } from '@/theme/palette';
import { TabGlyph } from '@/navigation/tab-glyph';

/**
 * 도감's two doors (Issue #412). 내 공간 is available from the first login. 동네 놀이 is opt-in: from the first coin on it is a hint that turns
 * the opt-in on when pressed, and it stays as that hint when the person becomes a regular without ever pressing it; once opted in it
 * is the plain entry.
 */
export function ExperienceEntry() {
  const router = useRouter();
  const palette = colorsForScheme(useColorScheme());
  const { stage, optIn, setOptIn } = useDiscovery();
  const showPlay = optIn.play || stage !== 'first-coin';
  return <View style={[styles.band, { borderColor: palette.separator }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="내 공간 꾸미기" onPress={() => router.push('/studio')} style={styles.entry}>
      <TabGlyph name="collection" color={palette.primary} size={24} />
      <View style={styles.copy}><Text style={[styles.title, { color: palette.label }]}>내 공간</Text><Text style={[styles.note, { color: palette.secondaryLabel }]}>동행 · 진열 · 다음 목표</Text></View>
    </Pressable>
    {showPlay ? <Pressable accessibilityRole="button" accessibilityLabel={optIn.play ? '동네 놀이 네 가지 게임' : '동네 놀이 켜고 열기'}
      onPress={() => { if (!optIn.play) void setOptIn({ play: true }); router.push('/play'); }} style={styles.entry}>
      <TabGlyph name="shop" color={palette.primary} size={24} />
      <View style={styles.copy}><Text style={[styles.title, { color: palette.label }]}>동네 놀이</Text>
        <Text style={[styles.note, { color: palette.secondaryLabel }]}>{optIn.play ? '네 가지 도전 · 공간 해금' : '눌러서 켜 보기 · 놀이 탭에도 있어요'}</Text></View>
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  band: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 8, marginVertical: 12 },
  entry: { flex: 1, minWidth: 145, minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  copy: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '800' },
  note: { fontSize: 12, lineHeight: 18 },
});
