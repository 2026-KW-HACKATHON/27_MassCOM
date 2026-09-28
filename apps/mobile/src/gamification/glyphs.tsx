import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import type { MedalKind } from './badge-api';

export const mascotStamp = require('../../assets/images/mascot/mascot-stamp.png');
export const mascotStampEmpty = require('../../assets/images/mascot/mascot-stamp-empty.png');
export const exploreBanner = require('../../assets/images/mascot/explore-banner.jpg');

/** Code-drawn kind marks (24×24): compass for explorer, rice bowl for regular, footprints for steady. */
export function MedalGlyph({ kind, size, color }: { kind: MedalKind; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {kind === 'explorer' ? (
        <G>
          <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} fill="none" />
          <Path d="M12 5.5 L15 12 L9 12 Z" fill={color} />
          <Path d="M12 18.5 L15 12 L9 12 Z" fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
          <Circle cx={12} cy={12} r={1.4} fill={color} />
        </G>
      ) : kind === 'regular' ? (
        <G>
          <Path d="M9 3.2c-1.2 1.3 1.2 2.3 0 3.8" stroke={color} strokeWidth={1.7} strokeLinecap="round" fill="none" />
          <Path d="M14 3.2c-1.2 1.3 1.2 2.3 0 3.8" stroke={color} strokeWidth={1.7} strokeLinecap="round" fill="none" />
          <Path d="M3.5 10.5h17a8.5 8 0 0 1-17 0z" fill={color} />
          <Rect x={8.5} y={18.6} width={7} height={2.2} rx={1.1} fill={color} />
        </G>
      ) : (
        <G>
          <Ellipse cx={8} cy={15.5} rx={2.7} ry={4} fill={color} transform="rotate(-12 8 15.5)" />
          <Circle cx={6.3} cy={10.2} r={1} fill={color} />
          <Circle cx={8.4} cy={9.7} r={1} fill={color} />
          <Circle cx={10.2} cy={10.4} r={0.9} fill={color} />
          <Ellipse cx={16} cy={9} rx={2.7} ry={4} fill={color} transform="rotate(12 16 9)" />
          <Circle cx={13.8} cy={3.9} r={0.9} fill={color} />
          <Circle cx={15.6} cy={3.2} r={1} fill={color} />
          <Circle cx={17.7} cy={3.7} r={1} fill={color} />
        </G>
      )}
    </Svg>
  );
}

/** Small gift mark for chips and pips. */
export function GiftGlyph({ size, color, ribbon }: { size: number; color: string; ribbon: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={4} y={10} width={16} height={11} rx={2} fill={color} />
      <Rect x={3} y={7} width={18} height={4.5} rx={1.5} fill={color} />
      <Rect x={10.6} y={7} width={2.8} height={14} fill={ribbon} />
      <Path d="M12 7c-2-4-6-4-5.5-1.5C7 7 12 7 12 7zM12 7c2-4 6-4 5.5-1.5C17 7 12 7 12 7z" fill={ribbon} />
    </Svg>
  );
}

export function CloseGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

export function CheckGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function SparkleGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 1.5c.8 5.2 3.3 7.7 10.5 10.5-7.2 2.8-9.7 5.3-10.5 10.5C11.2 17.3 8.7 14.8 1.5 12 8.7 9.2 11.2 6.7 12 1.5z" fill={color} />
    </Svg>
  );
}
