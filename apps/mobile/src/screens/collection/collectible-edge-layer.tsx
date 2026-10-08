import { useId, useMemo } from 'react';
import Svg, { Defs, G, Line, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';

import { collectibleEdgeGeometry } from './collectible-edge';
import { gradeMaterialPresets, type GradeMaterial } from './grade-material';

type Props = { shape: string; size: number; horizontal: number; depth: number; left: number; top: number; material: GradeMaterial; shade: string };

/** Geometric reeds share one fixed perimeter; no texture or saved media is needed. */
export function CollectibleEdgeLayer({ shape, size, horizontal, depth, left, top, material, shade }: Props) {
  const id = `collectible-edge-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const geometry = useMemo(() => collectibleEdgeGeometry(shape, size, horizontal, depth), [shape, size, horizontal, depth]);
  const colors = material === 'prism' ? gradeMaterialPresets.prism.rainbowStops : gradeMaterialPresets[material].colors;
  const stops = [shade, ...colors, shade];
  if (Math.abs(depth) < 1e-10) return null;
  return <Svg pointerEvents="none" accessible={false} width={geometry.width} height={size}
    style={{ position: 'absolute', left: left + geometry.leftOffset, top }}>
    <Defs>
      <LinearGradient id={`${id}-metal`} x1="0" y1="0" x2="0" y2="1">
        {stops.map((color, index) => <Stop key={index} offset={index / (stops.length - 1)} stopColor={color} />)}
      </LinearGradient>
      <Mask id={`${id}-side`} x={0} y={0} width={geometry.width} height={size} maskUnits="userSpaceOnUse">
        <Path d={geometry.backPath} fill="white" />
        {geometry.sidePaths.map((path, index) => <Path key={index} d={path} fill="white" stroke="white" strokeWidth={.3} />)}
        <Path d={geometry.frontPath} fill="black" />
      </Mask>
    </Defs>
    <G mask={`url(#${id}-side)`}>
      <Rect width={geometry.width} height={size} fill={`url(#${id}-metal)`} />
      {geometry.grooves.map(groove => <G key={groove.slot}>
        <Line x1={groove.x1} x2={groove.x2} y1={groove.y} y2={groove.y} stroke="black" strokeOpacity={geometry.darkOpacity} strokeWidth={geometry.strokeWidth} />
        <Line x1={groove.x1} x2={groove.x2} y1={groove.y + .6} y2={groove.y + .6} stroke="white" strokeOpacity={geometry.highlightOpacity} strokeWidth={geometry.strokeWidth} />
      </G>)}
    </G>
  </Svg>;
}
