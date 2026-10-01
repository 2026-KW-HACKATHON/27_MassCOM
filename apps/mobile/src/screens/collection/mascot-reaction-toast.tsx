import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { successHaptic } from '@/gamification/native-effects';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { colorsForScheme } from '@/theme/palette';
import { Mascot } from '@/ui/mascot';

import { reactionMessage, type ReactionEvent } from './mascot-reactions';

/** 17.1 마스코트 반응: 첫 수집품·새 가게 첫 수집품·시리즈 완성 때 한 번만 보이는 짧은 배너. 떠 있는 탭 바 위에 놓고 몇 초 뒤 스스로 닫힌다. */
export const REACTION_TOAST_MS = 6000;

export function MascotReactionToast({ event, onClose }: { event: ReactionEvent | undefined; onClose: () => void }) {
  const clearance = useTabBarClearance();
  const palette = colorsForScheme('light');
  useEffect(() => {
    if (!event) return;
    void successHaptic();
    const timer = setTimeout(onClose, REACTION_TOAST_MS);
    return () => clearTimeout(timer);
  }, [event, onClose]);
  if (!event) return null;
  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: clearance }]}>
      <View accessibilityLiveRegion="polite" style={[styles.card, { backgroundColor: palette.primary }]}>
        <Mascot pose="cheer" size={44} breathe={false} />
        <Text style={[styles.text, { color: palette.onPrimary }]}>{reactionMessage(event)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={styles.closeButton}>
          <Text style={[styles.closeText, { color: palette.onPrimary }]}>닫기</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18, maxWidth: 420, width: '100%' },
  text: { flex: 1, fontSize: 13, fontWeight: '800', lineHeight: 18 },
  closeButton: { minHeight: 32, minWidth: 32, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 12, fontWeight: '900' },
});
