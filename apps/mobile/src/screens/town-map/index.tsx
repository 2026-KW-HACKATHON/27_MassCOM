import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Pressable, RefreshControl, ScrollView, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
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

// Until the sheet has been measured, a scroll to reveal a pin assumes it is about this tall.
const SHEET_ESTIMATE = 260;
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
  const [selectedId, setSelectedId] = useState<string>();
  const [sheetHeight, setSheetHeight] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const mapWidth = Math.round(width - uiMetrics.pageInset * 2);
  const mapHeight = mapHeightFor(mapWidth);
  const { placed, overflow } = useMemo(
    () => buildTownPins(catalog.merchants, stamps.collection, new Date().toISOString()),
    [catalog.merchants, stamps.collection],
  );
  const selected = useMemo(
    () => [...placed, ...overflow].find((pin) => pin.merchantId === selectedId),
    [placed, overflow, selectedId],
  );
  const sheetBottom = clearance - 16 + SHEET_GAP;

  // Android back closes the open sheet before it leaves the tab.
  useEffect(() => {
    if (!selected) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setSelectedId(undefined); return true; });
    return () => subscription.remove();
  }, [selected]);

  const select = (pin: TownPin) => {
    setSelectedId(pin.merchantId);
    if (pin.slot === undefined) return;
    // Bring the pin out from under the sheet that is about to cover the bottom of the screen.
    const target = revealScrollY({
      pinY: headerHeight.current + frameY.current + pinCenter(TOWN_MAP_ANCHORS[pin.slot]!, mapWidth).y,
      scrollY: scrollY.current,
      viewportHeight: windowHeight,
      coverHeight: sheetBottom + (sheetHeight || SHEET_ESTIMATE),
      topInset: insets.top,
    });
    if (target !== null) scroll.current?.scrollTo({ y: target, animated: enabled });
  };

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
        contentContainerStyle={[styles.content, { paddingBottom: clearance + (selected ? sheetHeight + SHEET_GAP : 0) }]}
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
            {stamps.status === 'signedOut' ? <Text style={styles.banner}>로그인하면 도장 받은 곳이 표시돼요.</Text> : null}
            {stamps.status === 'loading' ? <Text accessibilityLiveRegion="polite" style={styles.banner}>도장 상태를 확인하고 있어요.</Text> : null}
            {stamps.status === 'error' ? (
              <Pressable accessibilityRole="button" onPress={() => { void stamps.reload(); }} style={styles.retry}>
                <Text style={styles.retryText}>도장 상태를 불러오지 못했어요. 눌러서 다시 시도</Text>
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
        <PinSheet pin={selected} bottom={sheetBottom} onClose={() => setSelectedId(undefined)} onMeasure={setSheetHeight} />
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
