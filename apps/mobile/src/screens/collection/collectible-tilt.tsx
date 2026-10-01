import { useEffect, useRef } from 'react';
import { SensorType, useAnimatedSensor } from 'react-native-reanimated';

import { tiltEmittedDegrees, tiltStep } from './collectible-tilt-math';

type Props = { onChange: (degrees: number) => void };

/**
 * Mounted only while the viewer turned tilt on, motion is allowed, and the app is foreground
 * (collectible-detail.tsx owns that gating). Already-installed Reanimated `useAnimatedSensor`,
 * no new dependency, no new permission (20 Hz well under the 200 Hz manifest-permission threshold).
 * Reads the gravity shared value on a plain JS-thread interval matching the 50ms sensor config —
 * simpler than an animated reaction, and plenty for a value that only needs to reach JS on change.
 */
export function TiltSensor({ onChange }: Props) {
  const sensor = useAnimatedSensor(SensorType.GRAVITY, { interval: 50 });
  const smoothed = useRef(0);
  const lastEmitted = useRef(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    const timer = setInterval(() => {
      const { x, y } = sensor.sensor.value;
      smoothed.current = tiltStep(x, y, smoothed.current);
      const emitted = tiltEmittedDegrees(smoothed.current);
      if (emitted !== lastEmitted.current) {
        lastEmitted.current = emitted;
        onChangeRef.current(emitted);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [sensor]);

  return null;
}
