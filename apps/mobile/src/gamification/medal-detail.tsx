import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { tierColors } from '@/theme/medal-colors';

import type { Medal } from './badge-api';
import {
  medalCopy,
  medalProgressText,
  medalTitle,
  nextTierProgress,
  sameDayRuleNote,
  tierName,
  type ShareVariant,
} from './badge-rules';
import { CheckGlyph, CloseGlyph } from './glyphs';
import { TierChip } from './medal-shelf';
import { Medallion, medallionSizes } from './medallion';
import { useBadgeShare } from './share-card';
import { useGamificationTheme } from './theme';

/** Medal detail sheet: big medal, tier table, progress, and "이미지로 공유" once a tier is earned. */
export function MedalDetail({ medal, variant, onClose }: { medal: Medal | undefined; variant: ShareVariant; onClose: () => void }) {
  return (
    <Modal visible={medal !== undefined} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <SafeAreaProvider>
        {medal ? <DetailBody medal={medal} variant={variant} onClose={onClose} /> : null}
      </SafeAreaProvider>
    </Modal>
  );
}

function DetailBody({ medal, variant, onClose }: { medal: Medal; variant: ShareVariant; onClose: () => void }) {
  const { styles, palette, medal: colors } = useGamificationTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const heading = useRef<Text>(null);
  const { host, share, sharing } = useBadgeShare(variant);
  const [shareError, setShareError] = useState<string>();
  const copy = medalCopy(medal.kind);
  const progress = nextTierProgress(medal);

  useEffect(() => {
    const focus = setTimeout(() => {
      if (heading.current) AccessibilityInfo.sendAccessibilityEvent(heading.current, 'focus');
    }, 350);
    return () => clearTimeout(focus);
  }, []);

  async function shareMedal() {
    setShareError(undefined);
    if ((await share(medal)) === 'failed') setShareError('공유 창을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} importantForAccessibility="no" />
      <View style={[styles.sheet, { maxHeight: height - insets.top - 12 }]} accessibilityViewIsModal>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text ref={heading} accessibilityRole="header" style={styles.sheetTitle}>{copy.name} 배지</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={styles.closeButton}>
            <CloseGlyph size={20} color={palette.label} />
          </Pressable>
        </View>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.detailHero}>
            <Medallion
              kind={medal.kind}
              tier={medal.tier}
              progress={progress.fraction}
              size={medallionSizes.detail}
              colors={colors}
              arcColor={palette.primary}
              trackColor={palette.separator}
              animateArc
            />
            <Text style={styles.detailTitle}>{medalTitle(medal)}</Text>
            <TierChip tier={medal.tier} />
            <Text style={styles.detailMeasure}>지금까지 {copy.measure(medal.value)}</Text>
          </View>

          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${copy.name} 다음 등급 진행`}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(progress.fraction * 100), text: medalProgressText(medal) }}
            style={{ gap: 8 }}
          >
            <Text style={styles.progressCaption}>{medalProgressText(medal)}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress.fraction * 100}%` }]} />
            </View>
          </View>

          <View style={styles.tierTable}>
            {([1, 2, 3] as const).map((tier) => {
              const threshold = medal.thresholds[tier - 1]!;
              const reached = medal.tier >= tier;
              const current = progress.nextTier === tier;
              const metal = tierColors(colors, tier);
              const status = reached ? '달성' : `${Math.max(0, threshold - medal.value)}${copy.unit} 남음`;
              return (
                <View
                  key={tier}
                  accessible
                  accessibilityLabel={`${tierName(tier)}, ${copy.measure(threshold)}, ${status}`}
                  style={[styles.tierRow, current && styles.tierRowCurrent]}
                >
                  <View style={[styles.tierDot, { borderColor: metal.edge, backgroundColor: reached ? metal.container : 'transparent' }]}>
                    <Text style={[styles.tierDotText, { color: reached ? metal.onContainer : palette.secondaryLabel }]}>{tier}</Text>
                  </View>
                  <View style={styles.tierRowCopy}>
                    <Text style={styles.tierRowName}>{tierName(tier)}</Text>
                    <Text style={styles.tierRowRule}>{copy.measure(threshold)}</Text>
                  </View>
                  {reached ? <CheckGlyph size={18} color={palette.success} /> : null}
                  <Text style={[styles.tierRowStatus, reached && styles.tierRowStatusDone]}>{status}</Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.ruleNote}>{copy.rule} {sameDayRuleNote}</Text>

          <View style={styles.sheetActions}>
            {medal.tier > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${medalTitle(medal)} 배지를 이미지로 공유`}
                accessibilityState={{ busy: sharing, disabled: sharing }}
                disabled={sharing}
                onPress={() => void shareMedal()}
                style={({ pressed }) => [styles.button, pressed && styles.pressed, sharing && styles.disabled]}
              >
                <Text style={styles.buttonText}>{sharing ? '카드 만드는 중…' : '이미지로 공유'}</Text>
              </Pressable>
            ) : (
              <Text style={styles.ruleNote}>브론즈를 받으면 배지 카드를 공유할 수 있어요.</Text>
            )}
            {shareError ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{shareError}</Text> : null}
            <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}>
              <Text style={styles.ghostButtonText}>닫기</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
      {host}
    </View>
  );
}
