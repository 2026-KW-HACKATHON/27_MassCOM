import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { ColorValue } from 'react-native';

type GlyphName = 'explore' | 'map' | 'claim' | 'collection' | 'friends' | 'shop' | 'account';

export function TabGlyph({ name, color, size }: {
  name: GlyphName;
  color: ColorValue;
  size: number;
}) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'explore' ? <>
        <Circle cx="10.5" cy="10.5" r="6.5" {...stroke} />
        <Path d="M15.5 15.5 21 21" {...stroke} />
      </> : null}
      {name === 'map' ? <>
        {/* A folded map: three panels with two creases. */}
        <Path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5Z" {...stroke} strokeLinejoin="round" />
        <Path d="M9 4v13.5M15 6.5V20" {...stroke} />
      </> : null}
      {name === 'claim' ? <>
        <Rect x="4" y="4" width="16" height="16" rx="3" {...stroke} />
        <Path d="m8 12 3 3 5-6" {...stroke} />
      </> : null}
      {name === 'collection' ? <>
        <Rect x="4" y="4" width="7" height="7" rx="1" {...stroke} />
        <Rect x="13" y="4" width="7" height="7" rx="1" {...stroke} />
        <Rect x="4" y="13" width="7" height="7" rx="1" {...stroke} />
        <Rect x="13" y="13" width="7" height="7" rx="1" {...stroke} />
      </> : null}
      {name === 'friends' ? <>
        {/* Two heads: the one in front is larger, the friend behind it is smaller. */}
        <Circle cx="9" cy="8.5" r="3.2" {...stroke} />
        <Path d="M3 19.5c.4-3.2 2.6-4.9 6-4.9s5.6 1.7 6 4.9" {...stroke} />
        <Circle cx="16.8" cy="9.5" r="2.5" {...stroke} />
        <Path d="M16 14.7c2.9-.2 4.6 1.3 5 4" {...stroke} />
      </> : null}
      {name === 'shop' ? <>
        {/* A little storefront: awning triangle over a doorway. */}
        <Path d="M4 9.5 6 4h12l2 5.5" {...stroke} strokeLinejoin="round" />
        <Path d="M4 9.5h16v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2 2 2 0 0 1-2 2 2 2 0 0 1-2-2 2 2 0 0 1-2 2 2 2 0 0 1-2-2v-2Z" {...stroke} strokeLinejoin="round" />
        <Path d="M6 13.5V20h12v-6.5" {...stroke} strokeLinejoin="round" />
        <Rect x="10" y="15.5" width="4" height="4.5" rx="0.5" {...stroke} />
      </> : null}
      {name === 'account' ? <>
        <Circle cx="12" cy="8" r="3.5" {...stroke} />
        <Path d="M5 20c.5-3.4 3-5 7-5s6.5 1.6 7 5" {...stroke} />
      </> : null}
    </Svg>
  );
}
