import { useCallback } from 'react';
import { StyleSheet, useColorScheme, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMotionEnabled } from '../motion/use-motion';
import { withAlpha } from '../theme/contrast';
import { worldForScheme } from '../theme/world';
import { scrimRange } from './status-bar-scrim-range';

/** Scroll offset of a sky screen's scroller. Spread `onScroll` onto the ScrollView / FlatList and draw StatusBarScrim beside it. */
export function useStatusBarScrim() {
  const scrollY = useSharedValue(0);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.set(event.nativeEvent.contentOffset.y);
  }, [scrollY]);
  return { scrollY, onScroll };
}

/**
 * Solid strip over the status bar. The header art and text scroll away, and without this the clock and icons would sit on top of
 * whatever comes next. It fades in over the first ~24dp of scrolling; with reduced motion it just switches on halfway.
 * Place it after the scroller inside the screen's positioned root (SkyBackdrop); it never takes touches.
 */
export function StatusBarScrim({ scrollY }: { scrollY: SharedValue<number> }) {
  const world = worldForScheme(useColorScheme());
  const insets = useSafeAreaInsets();
  const enabled = useMotionEnabled();
  const top = insets.top;
  const [from, to] = scrimRange(top);
  const animated = useAnimatedStyle(() => {
    if (to <= from) return { opacity: 0 };
    const offset = scrollY.get();
    return { opacity: enabled ? interpolate(offset, [from, to], [0, 1], Extrapolation.CLAMP) : offset >= (from + to) / 2 ? 1 : 0 };
  });
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[styles.scrim, { height: insets.top, backgroundColor: withAlpha(world.sky[2], world.statusScrimAlpha) }, animated]}
    />
  );
}

const styles = StyleSheet.create({
  // elevation은 paint order와 별개로 Android의 Z 스택을 정한다: 뒤에 그려지는(JSX 순서상 뒤) 뷰라도 elevation이
  // 더 큰 형제(카드류는 ui/styles.ts의 card에서 elevation:3·2를 쓴다)가 있으면 그 카드가 이 스크림 위로 올라와
  // 스크롤이 지난 카드 텍스트가 상태 바 아이콘 자리에 다시 비치는 것처럼 보일 수 있다. 이 저장소에서 쓰는 카드류
  // elevation보다 뚜렷이 높은 값을 줘 항상 맨 위에 그려지게 한다.
  // shadowColor를 투명으로 둬 elevation은 Z 순서에만 쓰고(iOS의 shadow*는 이 투명 색 때문에 아무것도 그리지
  // 않는다), Android 쪽 elevation의 네이티브 드롭 섀도까지는 받지 않는다 — 안 그러면 스크림 밑에 옅은 그림자
  // 선이 생긴다(PR #312 리뷰, Claude P1).
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, elevation: 24, shadowColor: 'transparent' },
});
