import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, BackHandler, Image, Platform, Pressable, ScrollView,
  StyleSheet, Text, View, useColorScheme, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { INITIAL_PAGE, PAGE_COUNT, pageAtOffset } from '@/navigation/foundation-pages';
import { foundationColors } from '@/theme/foundation';
import { worldForScheme } from '@/theme/world';
import { FloatingCard } from '@/ui/floating-card';
import { Mascot } from '@/ui/mascot';
import { mascotArt } from '@/ui/mascot-art';
import { SkyArt } from '@/ui/sky-art';
import { SkyBackdrop } from '@/ui/sky-backdrop';

type Role = 'customer' | 'merchant';
type Props = {
  initialRole?: Role;
  isFocused?: boolean;
  onConnectWallet?: () => void;
  onChooseRole?: (role: Role) => void;
  showcaseTour?: boolean;
  onExit?: () => void;
};
const pages = Array.from({ length: PAGE_COUNT }, (_, index) => index);

export function FoundationScreen({ initialRole, isFocused = true, onConnectWallet, onChooseRole, showcaseTour = false, onExit }: Props) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = foundationColors[scheme];
  const world = worldForScheme(scheme);
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState<Role | undefined>(initialRole);
  const [stage, setStage] = useState<'role' | 'wallet' | 'shell'>(initialRole ? 'shell' : 'role');

  useEffect(() => {
    if (!isFocused || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stage === 'role') return false;
      if (showcaseTour && onExit) {
        onExit();
        return true;
      }
      setStage('role');
      setRole(undefined);
      return true;
    });
    return () => subscription.remove();
  }, [isFocused, onExit, showcaseTour, stage]);

  function choose(nextRole: Role) {
    if (onChooseRole) {
      onChooseRole(nextRole);
      return;
    }
    setRole(nextRole);
    setStage(nextRole === 'customer' ? 'wallet' : 'shell');
  }

  const inShell = stage === 'shell' && role !== undefined;
  const frame = (
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text
          selectable
          style={[
            styles.previewNotice,
            inShell ? { color: colors.muted } : [styles.noticeOnSky, { color: world.cardMuted, backgroundColor: world.card }],
          ]}
        >
          {showcaseTour
            ? '체험용 빈 공간 다섯 개입니다. 실제 방문·수집품 정보는 탐색과 도감에서 확인하세요.'
            : onChooseRole
            ? '체험용 가상 데이터입니다. 실제 영업점·방문 혜택과 연결되지 않습니다.'
            : '개발용 화면 시안 · 실제 음식점·방문·혜택이 아닙니다.'}
        </Text>
        {inShell ? (
          <EmptyPager
            role={role!}
            backLabel={showcaseTour ? '체험 종료' : '역할 다시 선택'}
            onBack={showcaseTour && onExit ? onExit : () => { setStage('role'); setRole(undefined); }}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.onboarding} showsVerticalScrollIndicator={false}>
            {stage === 'role' ? <SkyArt /> : null}
            <View style={styles.brandRow}>
              <Image source={mascotArt['logo-badge']} accessible={false} style={styles.brandBadge} />
              <Text style={[styles.brand, { color: world.skyInk }]}>월계 마스코트</Text>
            </View>
            {stage === 'role' ? (
              <>
                <View style={styles.greeting}>
                  <Mascot interactive pose="wave" size={160} accessibilityLabel="손을 흔드는 마스코트" />
                  <Text accessibilityRole="header" style={[styles.title, styles.greetingTitle, { color: world.skyInk }]}>반가워요! 동네 탐험을 시작해요</Text>
                  <Text style={[styles.description, styles.greetingTitle, { color: world.skyMuted }]}>어떤 모습으로 시작할까요?</Text>
                </View>
                <View style={styles.roleChoices}>
                  <RoleChoice title="사용자예요" subtitle="나의 공간으로 시작" role="customer" onPress={() => choose('customer')} />
                  <RoleChoice title="점주예요" subtitle={!onChooseRole ? '점주 화면 미리보기' : Platform.OS === 'web' ? '내 체험 가게가 바로 열려요' : '로그인하면 점주 권한을 확인해요'} role="merchant" onPress={() => choose('merchant')} />
                </View>
                <Text style={[styles.footnote, { color: world.skyMuted }]}>편하게 선택해 주세요. 언제든 바꿀 수 있어요.</Text>
              </>
            ) : (
              <>
                <View style={styles.intro}>
                  <View style={[styles.walletIcon, { backgroundColor: colors.tint }]}><Glyph kind="wallet" color={colors.accent} size={40} /></View>
                  <Text style={[styles.eyebrow, { color: colors.accent }]}>선택 사항</Text>
                  <Text accessibilityRole="header" style={[styles.walletTitle, { color: colors.ink }]}>외부지갑을{ '\n' }연결하실 건가요?</Text>
                  <Text style={[styles.description, { color: colors.muted }]}>지금 연결하지 않아도 괜찮아요.</Text>
                </View>
                <View style={styles.walletActions}>
                  <Pressable accessibilityRole="button" onPress={() => { setStage('shell'); onConnectWallet?.(); }} style={({ pressed }) => [styles.primary, { backgroundColor: colors.accent, opacity: pressed ? 0.75 : 1 }]}>
                    <Text style={[styles.actionLabel, { color: colors.onAccent }]}>외부지갑 연결하기</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setStage('shell')} style={styles.secondary}>
                    <Text style={[styles.actionLabel, { color: colors.muted }]}>지금은 건너뛰기</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setStage('role')} style={styles.secondary}>
                    <Text style={[styles.smallLabel, { color: colors.muted }]}>역할 다시 선택</Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        )}
      </View>
  );

  return inShell
    ? <View style={[styles.root, { backgroundColor: colors.background }]}>{frame}</View>
    : <SkyBackdrop>{frame}</SkyBackdrop>;
}

function RoleChoice({ title, subtitle, role, onPress }: { title: string; subtitle: string; role: Role; onPress: () => void }) {
  const world = worldForScheme(useColorScheme() === 'dark' ? 'dark' : 'light');
  return (
    <FloatingCard accessibilityLabel={`${title}. ${subtitle}`} onPress={onPress} style={styles.roleCard}>
      <View style={[styles.roleIcon, { backgroundColor: world.paper }]}>
        <Image source={mascotArt[role === 'customer' ? 'explore-map' : 'stamp']} accessible={false} style={styles.roleArt} />
      </View>
      <View style={styles.roleText}>
        <Text style={[styles.roleTitle, { color: world.cardInk }]}>{title}</Text>
        <Text style={[styles.smallLabel, { color: world.cardMuted }]}>{subtitle}</Text>
      </View>
      <Text accessible={false} style={[styles.chevron, { color: world.cardMuted }]}>›</Text>
    </FloatingCard>
  );
}

function EmptyPager({ role, onBack, backLabel }: { role: Role; onBack: () => void; backLabel: string }) {
  const colors = foundationColors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const pager = useRef<ScrollView>(null);
  const [scrollX] = useState(() => new Animated.Value(0));
  const currentPage = useRef(INITIAL_PAGE);
  const [selected, setSelected] = useState(INITIAL_PAGE);
  const [width, setWidth] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => { currentPage.current = selected; }, [selected]);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (!width) return;
    const offset = currentPage.current * width;
    scrollX.setValue(offset);
    const frame = requestAnimationFrame(() => pager.current?.scrollTo({ x: offset, animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [width, scrollX]);

  function select(index: number) {
    if (width) pager.current?.scrollTo({ x: index * width, animated: !reduceMotion });
  }

  function track(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = pageAtOffset(event.nativeEvent.contentOffset.x, width);
    setSelected(index);
  }

  const tabWidth = barWidth / PAGE_COUNT;
  const translateX = scrollX.interpolate({ inputRange: [0, Math.max(width * (PAGE_COUNT - 1), 1)], outputRange: [0, tabWidth * (PAGE_COUNT - 1)], extrapolate: 'clamp' });

  return (
    <View style={styles.pagerRoot}>
      <View style={styles.shellHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={styles.back}>
          <Text style={[styles.chevron, { color: colors.ink }]}>‹</Text>
        </Pressable>
        <Text style={[styles.shellTitle, { color: colors.ink }]}>{role === 'merchant' ? '점주' : '사용자'}</Text>
        {role === 'merchant' ? <View style={[styles.demo, { backgroundColor: colors.tint }]}><Text style={[styles.demoText, { color: colors.accent }]}>DEMO</Text></View> : null}
        <Text accessibilityLabel={`${selected + 1}번째 공간, 총 5개`} style={[styles.pageCount, { color: colors.muted }]}>{String(selected + 1).padStart(2, '0')} <Text style={{ color: colors.muted }}>/ 05</Text></Text>
      </View>
      <View style={styles.pagerRoot} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Animated.ScrollView
            ref={pager} horizontal pagingEnabled bounces={false} overScrollMode="never"
            showsHorizontalScrollIndicator={false} scrollEventThrottle={16}
            contentOffset={{ x: INITIAL_PAGE * width, y: 0 }}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: Platform.OS !== 'web', listener: track })}
            style={styles.pagerRoot}
          >
            {pages.map(index => <View key={index} style={{ width, flex: 1, backgroundColor: colors.background }} accessibilityElementsHidden={selected !== index} importantForAccessibility={selected === index ? 'auto' : 'no-hide-descendants'} />)}
          </Animated.ScrollView>
        ) : null}
      </View>
      <View style={[styles.footer, { borderTopColor: colors.line }]}>
        <View style={styles.tabTrack} onLayout={event => setBarWidth(event.nativeEvent.layout.width)}>
          {barWidth > 0 ? <Animated.View pointerEvents="none" style={[styles.indicator, { width: tabWidth, transform: [{ translateX }] }]}><View style={[styles.pill, { backgroundColor: colors.tint }]} /></Animated.View> : null}
          {pages.map(index => (
            <Pressable key={index} accessibilityRole="tab" accessibilityLabel={`${index + 1}번째 공간`} accessibilityState={{ selected: selected === index }} aria-selected={selected === index} onPress={() => select(index)} style={styles.tab}>
              <Glyph kind={index} color={selected === index ? colors.accent : colors.muted} size={23} />
              <Text maxFontSizeMultiplier={1.4} style={[styles.tabLabel, { color: selected === index ? colors.accent : colors.muted }]}>{String(index + 1).padStart(2, '0')}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function Glyph({ kind, color, size }: { kind: Role | 'wallet' | number; color: string; size: number }) {
  const stroke = { stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={Platform.OS === 'web' ? undefined : false} aria-hidden>
    {kind === 'customer' ? <><Circle cx="12" cy="8" r="3.5" {...stroke} /><Path d="M5 21v-2a7 7 0 0 1 14 0v2" {...stroke} /></> : null}
    {kind === 'merchant' ? <><Path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10c0 4 5 4 5 0 0 4 8 4 8 0 0 4 5 4 5 0M10 20v-5h4v5" {...stroke} /></> : null}
    {kind === 'wallet' ? <><Rect x="3" y="5" width="18" height="15" rx="3" {...stroke} /><Path d="M16 10h5v6h-5a3 3 0 0 1 0-6Z" {...stroke} /><Circle cx="17" cy="13" r={0.7} fill={color} /></> : null}
    {kind === 0 ? <Circle cx="12" cy="12" r="7" {...stroke} /> : null}
    {kind === 1 ? <Rect x="5" y="5" width="14" height="14" rx="4" {...stroke} /> : null}
    {kind === 2 ? <Path d="m12 3 9 9-9 9-9-9 9-9Z" {...stroke} /> : null}
    {kind === 3 ? <><Circle cx="9" cy="12" r="6" {...stroke} /><Circle cx="15" cy="12" r="6" {...stroke} /></> : null}
    {kind === 4 ? <><Rect x="4" y="4" width="6" height="6" rx="2" {...stroke} /><Rect x="14" y="4" width="6" height="6" rx="2" {...stroke} /><Rect x="4" y="14" width="6" height="6" rx="2" {...stroke} /><Rect x="14" y="14" width="6" height="6" rx="2" {...stroke} /></> : null}
  </Svg>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, frame: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  previewNotice: { paddingHorizontal: 20, paddingTop: 8, fontSize: 12, lineHeight: 18 },
  onboarding: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 32, paddingBottom: 24 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, brand: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  brandBadge: { width: 36, height: 36 },
  noticeOnSky: { alignSelf: 'stretch', marginHorizontal: 20, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, overflow: 'hidden' },
  greeting: { alignItems: 'center', paddingTop: 20, paddingBottom: 28, gap: 8 }, greetingTitle: { textAlign: 'center' },
  intro: { paddingTop: 72, paddingBottom: 40, gap: 12 }, eyebrow: { fontSize: 14, fontWeight: '600' },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -1, lineHeight: 40 },
  walletTitle: { fontSize: 32, fontWeight: '700', letterSpacing: -1.3, lineHeight: 44 },
  description: { fontSize: 16, lineHeight: 25 }, roleChoices: { gap: 14 },
  roleCard: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 16 },
  roleIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, roleArt: { width: 52, height: 52 }, roleText: { flex: 1, gap: 7 },
  roleTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5 }, smallLabel: { fontSize: 13, lineHeight: 20 }, chevron: { fontSize: 30 },
  footnote: { fontSize: 12, lineHeight: 20, textAlign: 'center', paddingTop: 28 }, walletIcon: { width: 76, height: 76, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  walletActions: { marginTop: 'auto', paddingTop: 28, gap: 8 }, primary: { borderRadius: 18, minHeight: 60, padding: 16, alignItems: 'center', justifyContent: 'center' },
  secondary: { minHeight: 48, padding: 12, alignItems: 'center', justifyContent: 'center' }, actionLabel: { fontSize: 16, fontWeight: '600' },
  pagerRoot: { flex: 1 }, shellHeader: { minHeight: 76, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { minWidth: 48, minHeight: 48, justifyContent: 'center' }, shellTitle: { fontSize: 18, fontWeight: '600' },
  demo: { borderRadius: 7, paddingVertical: 4, paddingHorizontal: 7 }, demoText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  pageCount: { marginLeft: 'auto', fontSize: 12, fontVariant: ['tabular-nums'] },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10 },
  tabTrack: { flexDirection: 'row', position: 'relative' }, tab: { flex: 1, minHeight: 62, alignItems: 'center', justifyContent: 'center', gap: 5 },
  tabLabel: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  indicator: { position: 'absolute', top: 0, bottom: 0, paddingHorizontal: 5 }, pill: { flex: 1, borderRadius: 20 },
});
