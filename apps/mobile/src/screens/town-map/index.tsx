import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, Image, Pressable, RefreshControl, ScrollView, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { useMotionEnabled } from '@/motion/use-motion';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { withAlpha } from '@/theme/contrast';
import { colorsForScheme } from '@/theme/palette';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';
import { AppHeader } from '@/ui/app-header';
import { FloatingCard } from '@/ui/floating-card';
import { isLargeText } from '@/ui/large-text';
import { townMapArt } from '@/ui/mascot-art';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

import { TOWN_MAP_ANCHORS } from './anchors';
import { TOWN_MAP_DISCLOSURE, TOWN_MAP_TITLE } from './copy';
import { mapHeightFor, pinCenter, revealScrollY } from './layout';
import { PinSheet } from './pin-sheet';
import { CheckMark, TownPinButton } from './town-pin';
import { buildTownPins, type TownPin } from './town-pins';
import { useTownCollection } from './use-town-collection';
import { useTownMapStyles } from './use-town-map-styles';

type Props = {
  apiUrl: string;
  /** Without a credential the map still shows every shop, only without stamps. */
  credential?: AccountCredential;
  onSessionInvalid: () => Promise<void>;
};

// The sheet floats this far above the tab bar's footprint (which includes the raised claim stamp).
const SHEET_GAP = 8;

export function TownMapScreen({ apiUrl, credential, onSessionInvalid }: Props) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const styles = useTownMapStyles();
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight, fontScale } = useWindowDimensions();
  const clearance = useTabBarClearance();
  const enabled = useMotionEnabled();
  const catalog = useMerchantCatalog(apiUrl);
  const stamps = useTownCollection({ apiUrl, credential, onSessionInvalid });

  const scroll = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const headerHeight = useRef(0);
  const frameY = useRef(0);
  // The pin buttons by shop, so a closing card can hand screen reader focus back to the pin that opened it.
  const openers = useRef(new Map<string, View>());
  const returnFocusTo = useRef<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string>();
  // The open sheet's height as it was laid out, for the shop it belongs to.
  const [sheetMeasure, setSheetMeasure] = useState<{ id: string; height: number }>();
  // A pin waiting to be scrolled clear of its sheet: `pinY` is its centre inside the scroll content.
  const [reveal, setReveal] = useState<{ id: string; pinY: number }>();
  const [refreshing, setRefreshing] = useState(false);

  const signedOut = stamps.status === 'signedOut';
  const mapWidth = Math.round(width - uiMetrics.pageInset * 2);
  const mapHeight = mapHeightFor(mapWidth);
  const { placed, overflow } = useMemo(
    () => buildTownPins(catalog.merchants, stamps.collection, new Date().toISOString(), { signedOut, loading: stamps.status === 'loading' }),
    [catalog.merchants, stamps.collection, signedOut, stamps.status],
  );
  const selected = useMemo(
    () => [...placed, ...overflow].find((pin) => pin.merchantId === selectedId),
    [placed, overflow, selectedId],
  );
  const sheetBottom = clearance - 16 + SHEET_GAP;
  const sheetOpen = selected !== undefined;

  const closeSheet = useCallback(() => {
    returnFocusTo.current = selectedId;
    setSelectedId(undefined);
    setReveal(undefined);
    // A reopened card must be measured again before it can lift its pin; a height left over from last time would let the
    // reveal run before the page has its new bottom padding.
    setSheetMeasure(undefined);
  }, [selectedId, setSheetMeasure]);

  // Android back closes the open sheet before it leaves the tab. Only while the map is the focused screen: on another tab, or
  // under the shop page that 자세히 보기 opened, the sheet must not swallow the first back press.
  useFocusEffect(useCallback(() => {
    if (!sheetOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closeSheet(); return true; });
    return () => subscription.remove();
  }, [sheetOpen, closeSheet]));

  // Closing a card drops screen reader focus with it; it goes back to the pin (or list row) that opened the card.
  useEffect(() => {
    const id = returnFocusTo.current;
    if (selectedId !== undefined || id === undefined) return;
    returnFocusTo.current = undefined;
    const opener = openers.current.get(id);
    if (opener) AccessibilityInfo.sendAccessibilityEvent(opener, 'focus');
  }, [selectedId]);

  const openerRef = (id: string) => (node: View | null) => {
    if (node) openers.current.set(id, node);
    else openers.current.delete(id);
  };

  const select = (pin: TownPin) => {
    setSelectedId(pin.merchantId);
    if (pin.slot === undefined) { setReveal(undefined); return; }
    // The pin is brought out from under the sheet once the sheet is there (see the effect below), not now: scrolling before the
    // sheet's padding exists would stop at the old end of the page.
    setReveal({
      id: pin.merchantId,
      pinY: headerHeight.current + frameY.current + pinCenter(TOWN_MAP_ANCHORS[pin.slot]!, mapWidth).y,
    });
  };

  // Runs after the sheet has been laid out and the page has its bottom padding: only then does the page reach far enough down.
  useEffect(() => {
    if (!reveal || sheetMeasure?.id !== reveal.id) return;
    const frame = requestAnimationFrame(() => {
      const target = revealScrollY({
        pinY: reveal.pinY,
        scrollY: scrollY.current,
        viewportHeight: windowHeight,
        coverHeight: sheetBottom + sheetMeasure.height,
        topInset: insets.top,
      });
      if (target !== null) scroll.current?.scrollTo({ y: target, animated: enabled });
      setReveal(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, sheetMeasure, sheetBottom, windowHeight, insets.top, enabled]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([catalog.refresh(), stamps.reload()]);
    } finally {
      setRefreshing(false);
    }
  };

  const hasShops = catalog.merchants.length > 0;
  return (
    <SkyBackdrop>
      <SkyScrollView
        ref={scroll}
        header={<AppHeader title={TOWN_MAP_TITLE} subtitle={TOWN_MAP_DISCLOSURE} />}
        onHeaderLayout={(height) => { headerHeight.current = height; }}
        onScroll={(event) => { scrollY.current = event.nativeEvent.contentOffset.y; }}
        contentContainerStyle={[styles.content, { paddingBottom: clearance + (selected ? (sheetMeasure?.height ?? 0) + SHEET_GAP : 0) }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void refresh(); }}
            tintColor={palette.primary}
            colors={[palette.primary]}
            progressBackgroundColor={world.card}
            progressViewOffset={insets.top}
          />
        }
      >
        {!hasShops ? (
          catalog.loading ? (
            <StateScene kind="loading" title="동네 지도를 펼치는 중" body="공개 중인 가게를 찾고 있어요." />
          ) : catalog.error ? (
            <StateScene kind="error" title="지금은 지도를 그리지 못했어요" body={catalog.error} action={{ label: '다시 불러오기', onPress: () => { void catalog.retry(); } }} />
          ) : (
            <StateScene kind="empty" title="아직 지도에 올릴 가게가 없어요" body="공개 중인 음식점이 생기면 여기에 핀이 나타나요." />
          )
        ) : (
          <>
            {/* The header drops its subtitle at 150% text, so the sentence is said here instead. */}
            {isLargeText(fontScale) ? <Text style={styles.disclosure}>{TOWN_MAP_DISCLOSURE}</Text> : null}
            {signedOut ? <Text style={styles.banner}>로그인하면 도장 받은 곳이 표시돼요.</Text> : null}
            {stamps.status === 'loading' ? <Text accessibilityLiveRegion="polite" style={styles.banner}>도장 상태를 확인하고 있어요.</Text> : null}
            {stamps.status === 'error' ? (
              <Pressable accessibilityRole="button" onPress={() => { void stamps.reload(); }} style={styles.retry}>
                <Text style={styles.retryText}>도장 상태를 불러오지 못했어요. 눌러서 다시 시도</Text>
              </Pressable>
            ) : null}
            {stamps.stale ? (
              <Pressable accessibilityRole="button" onPress={() => { void stamps.reload(); }} style={styles.retry}>
                <Text style={styles.retryText}>도장 상태가 최신이 아닐 수 있어요 · 다시 불러오기</Text>
              </Pressable>
            ) : null}
            {catalog.error ? (
              <Pressable accessibilityRole="button" onPress={() => { void catalog.retry(); }} style={styles.retry}>
                <Text style={styles.retryText}>{catalog.error} 눌러서 다시 시도</Text>
              </Pressable>
            ) : null}
            <View onLayout={(event) => { frameY.current = event.nativeEvent.layout.y; }} style={styles.mapFrame}>
              <View style={{ width: mapWidth, height: mapHeight }}>
                <Image
                  source={townMapArt}
                  accessible={false}
                  accessibilityIgnoresInvertColors
                  resizeMode="cover"
                  style={{ width: mapWidth, height: mapHeight }}
                />
                {/* The night sky's dimming layer, so the bright picture does not glare in dark mode. */}
                {scheme === 'dark' ? (
                  <View pointerEvents="none" accessible={false} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: withAlpha(world.headerScrim, 0.3) }} />
                ) : null}
                {placed.map((pin) => {
                  const center = pinCenter(TOWN_MAP_ANCHORS[pin.slot]!, mapWidth);
                  return (
                    <TownPinButton
                      key={pin.merchantId}
                      pin={pin}
                      x={center.x}
                      y={center.y}
                      selected={pin.merchantId === selectedId}
                      onPress={() => select(pin)}
                      pressableRef={openerRef(pin.merchantId)}
                    />
                  );
                })}
              </View>
              <Legend />
            </View>
            {overflow.length > 0 ? (
              <FloatingCard>
                <Text accessibilityRole="header" style={styles.sheetName}>지도에 다 담지 못한 가게</Text>
                <View style={styles.overflowList}>
                  {overflow.map((item) => (
                    <Pressable
                      key={item.merchantId}
                      ref={openerRef(item.merchantId)}
                      accessibilityRole="button"
                      accessibilityLabel={item.label}
                      accessibilityHint="가게 카드 열기"
                      accessibilityState={{ selected: item.merchantId === selectedId }}
                      onPress={() => select(item)}
                      style={styles.overflowRow}
                    >
                      <Text style={styles.overflowName}>{item.name}</Text>
                      <Text style={styles.overflowState}>{item.status === 'visited' ? '도장 받음' : item.status === 'none' ? '도장 아직 없음' : '확인 안 됨'}</Text>
                    </Pressable>
                  ))}
                </View>
              </FloatingCard>
            ) : null}
          </>
        )}
      </SkyScrollView>
      {selected ? (
        // Keyed by shop: a new card is laid out (and measured) afresh, even when it happens to be as tall as the last one.
        <PinSheet
          key={selected.merchantId}
          pin={selected}
          bottom={sheetBottom}
          onClose={closeSheet}
          onMeasure={(height) => setSheetMeasure({ id: selected.merchantId, height })}
        />
      ) : null}
    </SkyBackdrop>
  );
}

/** What the two ring shapes on the map mean, in words as well as shapes. */
function Legend() {
  const styles = useTownMapStyles();
  const world = worldForScheme(useColorScheme());
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={styles.legendVisited}><CheckMark color={world.stampInk} size={12} /></View>
        <Text maxFontSizeMultiplier={1.3} style={styles.legendText}>도장 받음</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={styles.legendNone} />
        <Text maxFontSizeMultiplier={1.3} style={styles.legendText}>아직 없음</Text>
      </View>
    </View>
  );
}
