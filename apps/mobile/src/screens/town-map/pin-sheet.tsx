import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { motion } from '@/motion/timing';
import { useMotionEnabled } from '@/motion/use-motion';
import { BounceButton } from '@/ui/bounce-button';
import { FloatingCard } from '@/ui/floating-card';
import { isLargeText } from '@/ui/large-text';

import { DEMO_NO_DIRECTIONS } from './copy';
import { directionsTargets, openDirections, type DirectionsProvider, type DirectionsTargets } from './directions';
import type { TownPin } from './town-pins';
import { useTownMapStyles } from './use-town-map-styles';

type Props = {
  pin: TownPin;
  /** Distance from the bottom of the screen: the sheet floats above the tab bar. */
  bottom: number;
  onClose: () => void;
  onMeasure: (height: number) => void;
};

/** Sheet rise: how far below its place it starts. */
const RISE = 16;

/** The shop card that floats up from the bottom when a pin (or a listed shop) is tapped. */
export function PinSheet({ pin, bottom, onClose, onMeasure }: Props) {
  const styles = useTownMapStyles();
  const router = useRouter();
  const enabled = useMotionEnabled();
  const { height, fontScale } = useWindowDimensions();
  const large = isLargeText(fontScale);
  const targets = directionsTargets(pin);
  const progress = useSharedValue(enabled ? 0 : 1);

  // Rises in when it opens or when another shop is chosen; with reduced motion it is simply there. A timer forces the end state
  // so a stalled animation can never leave the sheet see-through.
  useEffect(() => {
    if (!enabled) { progress.set(1); return; }
    progress.set(0);
    progress.set(withSpring(1, motion.spring));
    const failsafe = setTimeout(() => progress.set(1), motion.enterFailsafeMs);
    return () => clearTimeout(failsafe);
  }, [enabled, pin.merchantId, progress]);
  const animated = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.get()),
    transform: [{ translateY: (1 - progress.get()) * RISE }],
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      onLayout={(event) => onMeasure(event.nativeEvent.layout.height)}
      style={[styles.sheetWrap, { bottom }, animated]}
    >
      <FloatingCard>
        <ScrollView style={{ maxHeight: Math.round(height * 0.55) }} contentContainerStyle={styles.sheetBody} bounces={false} nestedScrollEnabled>
          <View accessibilityLiveRegion="polite" style={styles.sheetBody}>
            <View style={styles.sheetTop}>
              <Text accessibilityRole="header" maxFontSizeMultiplier={1.6} style={styles.sheetName}>{pin.name}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="가게 카드 닫기" onPress={onClose} style={styles.closeButton}>
                <Text maxFontSizeMultiplier={1.3} style={styles.closeText}>닫기</Text>
              </Pressable>
            </View>
            <Text numberOfLines={2} style={styles.sheetAddress}>{pin.roadAddress}</Text>
            <Text style={styles.sheetStatus}>{pin.statusLine}</Text>
            {pin.goalLine ? <Text style={styles.sheetGoal}>{pin.goalLine}</Text> : null}
          </View>
          <View style={[styles.sheetActions, large ? { flexDirection: 'column' } : null]}>
            <View style={styles.sheetAction}>
              <BounceButton
                label="자세히 보기"
                onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: pin.merchantId } })}
              />
            </View>
            {targets ? (
              <View style={styles.sheetAction}>
                <BounceButton variant="secondary" label="길찾기" onPress={() => chooseProvider(pin, targets)} />
              </View>
            ) : null}
          </View>
          {!targets && pin.demo ? <Text style={styles.sheetNotice}>{DEMO_NO_DIRECTIONS}</Text> : null}
        </ScrollView>
      </FloatingCard>
    </Animated.View>
  );
}

function chooseProvider(pin: Pick<TownPin, 'name' | 'roadAddress'>, targets: DirectionsTargets) {
  const go = async (provider: DirectionsProvider) => {
    if (!(await openDirections(targets, provider))) {
      Alert.alert('지도를 열지 못했어요', '지도 앱이나 인터넷 연결을 확인하고 다시 눌러 주세요.');
    }
  };
  Alert.alert(
    '길찾기',
    `${pin.name}\n${pin.roadAddress}\n\n어느 지도로 열까요? 도로명 주소로 검색하며, 이 앱은 내 위치를 쓰지 않아요.`,
    [
      { text: '네이버 지도', onPress: () => void go('naver') },
      { text: '카카오맵', onPress: () => void go('kakao') },
      { text: '취소', style: 'cancel' },
    ],
    { cancelable: true },
  );
}
