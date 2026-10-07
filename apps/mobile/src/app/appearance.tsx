import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Text, View, useColorScheme } from 'react-native';
import { TabGlyph } from '@/navigation/tab-glyph';
import { tabAppearanceColors, type TabAppearance } from '@/navigation/tab-appearance';
import { useTabAppearance } from '@/navigation/tab-appearance-provider';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { spaceToggles } from '@/ui/space-toggles';
import { useUiStyles } from '@/ui/use-ui-styles';
import { colorsForScheme } from '@/theme/palette';

export default function AppearanceScreen() {
  const stored = useTabAppearance();
  const [selection, setSelection] = useState<{ base: TabAppearance; draft: TabAppearance }>();
  const draft = selection?.base === stored.appearance ? selection.draft : stored.appearance;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const dark = useColorScheme() === 'dark';
  const palette = colorsForScheme(dark ? 'dark' : 'light');
  const ui = useUiStyles();
  const colors = tabAppearanceColors(draft, dark);
  function choose<K extends keyof TabAppearance>(key: K, value: TabAppearance[K]) { setSelection({ base: stored.appearance, draft: { ...draft, [key]: value } }); setSaved(false); }
  return <SkyBackdrop><SkyScrollView header={<BackHeader title="하단 바 꾸미기" />} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 18 }}>
    <Text style={ui.cardBody}>다섯 메뉴의 순서는 그대로, 나만의 분위기로 바꿔요.</Text>
    <FloatingCard>
      <Text style={ui.cardTitle}>미리보기</Text>
      <View style={{ flexDirection: 'row', marginTop: 16, borderRadius: 22, padding: 8, backgroundColor: colors.background }}>
        {(['map', 'collection', 'home', 'play', 'shop'] as const).map((name, i) => <View key={name}
          style={{ flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 16, backgroundColor: i === 2 ? colors.selected : 'transparent' }}>
          <TabGlyph name={name} color={i === 2 ? colors.active : colors.inactive} size={26} filled={draft.icons === 'filled'} />
          <Text style={{ color: i === 2 ? colors.active : colors.inactive, fontSize: 12 }}>{['탐색', '도감', '홈', '놀이', '상점'][i]}</Text>
        </View>)}
      </View>
    </FloatingCard>
    {([
      ['theme', '테마', [['mint', '기본 민트'], ['wood', '따뜻한 우드'], ['night', '밤하늘']]],
      ['accent', '포인트 색상', [['mint', '민트'], ['blue', '블루'], ['rose', '로즈']]],
      ['icons', '아이콘 표현', [['line', '선 아이콘'], ['filled', '채운 아이콘']]],
    ] as const).map(([key, title, choices]) => <View key={key} style={{ gap: 10 }}>
      <Text style={ui.cardTitle}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {choices.map(([value, label]) => <Pressable key={value} accessibilityRole="radio"
          accessibilityState={{ checked: draft[key] === value }} aria-checked={draft[key] === value} disabled={!stored.ready || saving}
          onPress={() => choose(key, value)} {...(Platform.OS === 'web' ? { onKeyDown: spaceToggles(() => { if (stored.ready && !saving) choose(key, value); }) } : {})} style={{ minHeight: 54, flexGrow: 1, padding: 14, borderRadius: 16,
            backgroundColor: draft[key] === value ? palette.primaryContainer : palette.surface,
            borderWidth: 2, borderColor: draft[key] === value ? palette.primary : palette.separator }}>
          <Text style={{ color: palette.label, fontWeight: draft[key] === value ? '800' : '500', textAlign: 'center' }}>{draft[key] === value ? '✓ ' : ''}{label}</Text>
        </Pressable>)}
      </View>
    </View>)}
    {stored.error ? <Text accessibilityRole="alert" style={{ color: palette.error }}>{stored.error}</Text> : null}
    {saved ? <Text accessibilityLiveRegion="polite" style={{ color: palette.success }}>하단 바에 적용했어요.</Text> : null}
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Pressable accessibilityRole="button" disabled={saving} style={[ui.secondaryButton, { flex: 1 }]} onPress={() => { setSelection(undefined); router.back(); }}><Text style={ui.secondaryButtonText}>취소</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={!stored.ready || saving} style={[ui.primaryButton, { flex: 1 }]} onPress={async () => {
        setSaving(true); try { setSaved(await stored.save(draft)); } finally { setSaving(false); }
      }}><Text style={ui.primaryButtonText}>{saving ? '저장 중' : '적용'}</Text></Pressable>
    </View>
  </SkyScrollView></SkyBackdrop>;
}
