import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { ColorValue } from 'react-native';

type GlyphName = 'explore' | 'map' | 'claim' | 'collection' | 'friends' | 'shop' | 'account' | 'home' | 'mail' | 'play';

export function TabGlyph({ name, color, size, filled = false }: {
  name: GlyphName;
  color: ColorValue;
  size: number;
  filled?: boolean;
}) {
  const face = filled ? color : 'none';
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const };

  return (
    <Svg accessible={false} width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'explore' ? <>
        <Circle cx="10.5" cy="10.5" r="6.5" {...stroke} />
        <Path d="M15.5 15.5 21 21" {...stroke} />
      </> : null}
      {name === 'play' ? <>
        <Rect x="3" y="6" width="18" height="13" rx="4" {...stroke} />
        <Path d="M7 10v5M4.5 12.5h5" {...stroke} />
        <Circle cx="16" cy="10.5" r="1" fill={color} /><Circle cx="18" cy="14" r="1" fill={color} />
      </> : null}
      {name === 'home' ? <>
        <Path d="M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3Z" {...stroke} fill={face} strokeLinejoin="round" />
      </> : null}
      {name === 'map' ? <>
        <Path d="M12 22s8-8 8-14a8 8 0 0 0-16 0c0 6 8 14 8 14Z" {...stroke} fill={face} strokeLinejoin="round" />
        <Circle cx="12" cy="8" r="3" fill={filled ? '#FFFFFF' : 'none'} stroke={filled ? '#FFFFFF' : color} strokeWidth="1.5" />
      </> : null}
      {name === 'claim' ? <>
        <Rect x="4" y="4" width="16" height="16" rx="3" {...stroke} />
        <Path d="m8 12 3 3 5-6" {...stroke} />
      </> : null}
      {name === 'collection' ? <>
        <Path d="M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-3-1-6-2-10 1Z" {...stroke} strokeLinejoin="round" />
        <Path d="M12 5v15" {...stroke} />
        {filled ? <><Path d="M5 7h4M5 10h4M15 7h4M15 10h4" {...stroke} /></> : null}
      </> : null}
      {name === 'friends' ? <>
        {/* Two heads: the one in front is larger, the friend behind it is smaller. */}
        <Circle cx="9" cy="8.5" r="3.2" {...stroke} />
        <Path d="M3 19.5c.4-3.2 2.6-4.9 6-4.9s5.6 1.7 6 4.9" {...stroke} />
        <Circle cx="16.8" cy="9.5" r="2.5" {...stroke} />
        <Path d="M16 14.7c2.9-.2 4.6 1.3 5 4" {...stroke} />
      </> : null}
      {name === 'shop' ? <>
        <Path d="M5 8h14l2 13H3Z" {...stroke} fill={face} strokeLinejoin="round" />
        <Path d="M8 9V5a4 4 0 0 1 8 0v4" {...stroke} />
      </> : null}
      {name === 'account' ? <>
        <Circle cx="12" cy="8" r="3.5" {...stroke} />
        <Path d="M5 20c.5-3.4 3-5 7-5s6.5 1.6 7 5" {...stroke} />
      </> : null}
      {name === 'mail' ? <>
        <Rect x="3.5" y="5.5" width="17" height="13" rx="2" {...stroke} />
        <Path d="m5 8 7 5 7-5" {...stroke} strokeLinejoin="round" />
      </> : null}
    </Svg>
  );
}
