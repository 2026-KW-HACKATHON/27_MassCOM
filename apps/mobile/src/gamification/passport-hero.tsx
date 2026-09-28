import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { BadgeBook } from './badge-api';
import { badgesToNextBox, explorerRank, firstReadyReward, rewardBoxName, showcaseRecordNote } from './badge-rules';
import { GiftGlyph, mascotStamp } from './glyphs';
import { useGamificationTheme } from './theme';

type Counts = { visits: number; appCollectibles: number; finalizedNfts: number };

type Props = {
  book: BadgeBook | undefined;
  counts: Counts;
  isShowcase: boolean;
  /** Count pills in one column (narrow screen or large text). */
  stackCounts: boolean;
  /** Mascot above the rank instead of beside it (very large text). */
  stackMain: boolean;
  /** Scrolls to the reward boxes; shown as a call to action while a box is READY. */
  onOpenRewards: () => void;
};

const maxTiers = 9;

/**
 * ① 탐험 여권: mascot stamp, explorer rank, badges n/9 as pips grouped by gift box, and a compact
 * visit / app collectible / real NFT strip. The only place the showcase notice appears.
 */
export function PassportHero({ book, counts, isShowcase, stackCounts, stackMain, onOpenRewards }: Props) {
  const { styles, medal, palette, scheme } = useGamificationTheme();
  const earned = book ? Math.min(maxTiers, book.earnedTiers) : 0;
  const rank = book ? explorerRank(book.earnedTiers).title : '나의 탐험 여권';
  const toNext = book ? badgesToNextBox(book) : null;
  const nextLine = !book
    ? '배지를 불러오면 탐험 등급이 보여요.'
    : toNext === null ? '모든 보상 상자에 닿았어요!' : `다음 상자까지 배지 ${toNext}개`;
  const pill = scheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.72)';
  const ready = firstReadyReward(book);

  return (
    <View style={styles.passport}>
      <PassportBackdrop sky={medal.sky} dark={scheme === 'dark'} />

      <View style={styles.passportEyebrowRow}>
        <Text style={styles.passportEyebrow}>나의 탐험 여권</Text>
      </View>

      <View style={[styles.passportMain, stackMain && styles.passportMainStacked]}>
        <View style={styles.passportStampFrame}>
          <Image source={mascotStamp} accessible={false} style={styles.passportStamp} />
        </View>
        <View style={styles.passportCopy}>
          <Text accessibilityRole="header" style={styles.passportRank}>{rank}</Text>
          {book ? (
            <Text style={styles.passportBadgeCount}>
              배지 <Text style={styles.passportBadgeNumber}>{earned}</Text> / {maxTiers}
            </Text>
          ) : null}
        </View>
      </View>

      {book ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="탐험 배지"
          accessibilityValue={{ min: 0, max: maxTiers, now: earned, text: `배지 ${earned}개 중 ${maxTiers}개, ${nextLine}` }}
          style={styles.pipRow}
        >
          {[0, 1, 2].map((group) => {
            const boxReached = earned >= (group + 1) * 3;
            return (
              <View key={group} style={styles.pipGroup}>
                {[0, 1, 2].map((slot) => {
                  const filled = group * 3 + slot < earned;
                  return (
                    <View
                      key={slot}
                      style={[styles.pip, {
                        borderColor: palette.primary,
                        backgroundColor: filled ? palette.primary : pill,
                      }]}
                    />
                  );
                })}
                <View style={{ opacity: boxReached ? 1 : 0.45, marginLeft: 1 }}>
                  <GiftGlyph size={20} color={group === 2 ? medal.giftGold : medal.giftPaperShade} ribbon={medal.ribbon} />
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      <Text style={styles.passportNext}>{nextLine}</Text>

      {ready ? (
        <View style={[styles.passportCta, { backgroundColor: scheme === 'dark' ? palette.primaryContainer : '#FFFFFF' }]}>
          <GiftGlyph size={30} color={ready.milestone === 3 ? medal.giftGold : medal.giftPaperShade} ribbon={medal.ribbon} />
          <Text style={styles.passportCtaText}>{rewardBoxName(ready.milestone)}를 열 수 있어요</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${rewardBoxName(ready.milestone)} 열러 가기`}
            onPress={onOpenRewards}
            style={({ pressed }) => [styles.passportCtaButton, pressed && styles.pressed]}
          >
            <Text style={styles.boxButtonText}>열기</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.countStrip, stackCounts && styles.countStripStacked]}>
        <CountPill label="방문" value={counts.visits} stacked={stackCounts} background={pill} />
        <CountPill label="앱 수집품" value={counts.appCollectibles} stacked={stackCounts} background={pill} />
        <CountPill label="실제 NFT" value={counts.finalizedNfts} stacked={stackCounts} background={pill} />
      </View>

      {isShowcase ? <Text style={styles.demoNote}>{showcaseRecordNote} · 실제 방문·혜택이 아니에요</Text> : null}
    </View>
  );
}

function CountPill({ label, value, stacked, background }: { label: string; value: number; stacked: boolean; background: string }) {
  const { styles } = useGamificationTheme();
  return (
    <View accessible accessibilityLabel={`${label} ${value}`} style={[styles.countPill, stacked && styles.countPillStacked, { backgroundColor: background }]}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function PassportBackdrop({ sky, dark }: { sky: readonly [string, string, string]; dark: boolean }) {
  const cloud = dark ? 0.06 : 0.6;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="passportSky" x1="0" y1="0" x2="0.35" y2="1">
          <Stop offset="0" stopColor={sky[0]} />
          <Stop offset="0.6" stopColor={sky[1]} />
          <Stop offset="1" stopColor={sky[2]} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#passportSky)" />
      <Ellipse cx="86%" cy="12%" rx="70" ry="22" fill="#FFFFFF" opacity={cloud} />
      <Ellipse cx="96%" cy="18%" rx="46" ry="16" fill="#FFFFFF" opacity={cloud * 0.8} />
      {/* A faint passport visa stamp in the corner. */}
      <Circle cx="92%" cy="88%" r="54" stroke={dark ? '#9BB8FF' : '#2456D6'} strokeOpacity={0.12} strokeWidth={3} fill="none" />
      <Circle cx="92%" cy="88%" r="44" stroke={dark ? '#9BB8FF' : '#2456D6'} strokeOpacity={0.1} strokeWidth={1.5} strokeDasharray="4 5" fill="none" />
    </Svg>
  );
}
