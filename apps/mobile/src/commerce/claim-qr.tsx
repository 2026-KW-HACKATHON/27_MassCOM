import { useMemo } from 'react';
import { View } from 'react-native';
import { create } from 'qrcode/lib/core/qrcode';
import Svg, { Path, Rect } from 'react-native-svg';

/** Draws the one-time code as a QR. The code never leaves the device through this component. */
export function ClaimQr({ code, size = 240 }: { code: string; size?: number }) {
  const { path, count } = useMemo(() => {
    const { modules } = create(code, { errorCorrectionLevel: 'M' });
    let d = '';
    for (let row = 0; row < modules.size; row += 1) {
      for (let column = 0; column < modules.size; column += 1) {
        if (modules.get(row, column)) d += `M${column} ${row}h1v1h-1z`;
      }
    }
    return { path: d, count: modules.size };
  }, [code]);
  const quiet = 4;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel="고객이 촬영할 1회 수령 QR 코드">
      <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`}>
        <Rect x={-quiet} y={-quiet} width={count + quiet * 2} height={count + quiet * 2} fill="#ffffff" />
        <Path d={path} fill="#000000" />
      </Svg>
    </View>
  );
}
