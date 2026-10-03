import { useEffect } from 'react';
import { SensorType, useAnimatedSensor, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { MaterialTilt } from './grade-material';

/** 상세가 보이고 동작이 허용될 때만 마운트한다. 회전 토글과 무관한 조명 전용 센서다. */
export function GradeMaterialSensor({ output }: { output: SharedValue<MaterialTilt> }) {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 32 });
  const neutral = useSharedValue<MaterialTilt | null>(null);
  const frame = useFrameCallback((info) => {
    'worklet';
    const reading = gravity.sensor.get();
    // 센서가 없거나 아직 첫 표본이 오지 않았으면 정면을 유지하고 자동 반사만 사용한다.
    if (!Number.isFinite(reading.x) || !Number.isFinite(reading.y) ||
      reading.x ** 2 + reading.y ** 2 + reading.z ** 2 < 1) return;
    if (neutral.get() === null) neutral.set({ x: reading.x, y: reading.y });
    const centre = neutral.get();
    if (centre === null) return;
    const x = Math.max(-1, Math.min(1, (reading.x - centre.x) / 9.81));
    const y = Math.max(-1, Math.min(1, (reading.y - centre.y) / 9.81));
    const weight = 1 - Math.exp(-Math.min(info.timeSincePreviousFrame ?? 32, 50) / 160);
    const previous = output.get();
    output.set({ x: previous.x + (x - previous.x) * weight, y: previous.y + (y - previous.y) * weight });
  });
  useEffect(() => () => {
    frame.setActive(false);
    output.set({ x: 0, y: 0 });
    // useAnimatedSensor가 자기 effect 정리에서 구독을 해제한다.
  }, [frame, output]);
  return null;
}
