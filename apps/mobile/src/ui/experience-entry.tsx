import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { colorsForScheme } from '@/theme/palette';
import { TabGlyph } from '@/navigation/tab-glyph';

export function ExperienceEntry() {
  const router = useRouter();
  const palette = colorsForScheme(useColorScheme());
  return <View style={[styles.band, { borderColor: palette.separator }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="내 공간 꾸미기" onPress={() => router.push('/studio')} style={styles.entry}>
      <TabGlyph name="collection" color={palette.primary} size={24} />
      <View style={styles.copy}><Text style={[styles.title, { color: palette.label }]}>내 공간</Text><Text style={[styles.note, { color: palette.secondaryLabel }]}>동행 · 진열 · 다음 목표</Text></View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="동네 놀이 네 가지 게임" onPress={() => router.push('/play')} style={styles.entry}>
      <TabGlyph name="shop" color={palette.primary} size={24} />
      <View style={styles.copy}><Text style={[styles.title, { color: palette.label }]}>동네 놀이</Text><Text style={[styles.note, { color: palette.secondaryLabel }]}>네 가지 도전 · 공간 해금</Text></View>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  band: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 8, marginVertical: 12 },
  entry: { flex: 1, minWidth: 145, minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  copy: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '800' },
  note: { fontSize: 12, lineHeight: 18 },
});
