import Svg, { Ellipse, Path } from 'react-native-svg';

import { TabGlyph } from '@/navigation/tab-glyph';

export function FriendActionIcon({ name, color }: { name: 'heart' | 'mail' | 'spoon' | 'home'; color: string }) {
  if (name === 'mail' || name === 'home') return <TabGlyph name={name} color={color} size={28} />;
  return <Svg accessible={false} width={28} height={28} viewBox="0 0 24 24" fill="none">
    {name === 'heart' ? <Path d="M12 21 3.6 13C-2 7.6 5.8.5 12 7c6.2-6.5 14 0.6 8.4 6Z" fill={color} stroke={color === '#D29A12' ? '#8B640D' : color} strokeWidth={1.5} strokeLinejoin="round" /> : <>
      <Ellipse cx={13.7} cy={6.7} rx={4.2} ry={5.5} transform="rotate(28 13.7 6.7)" fill={color} />
      <Path d="m11.4 10.5-5 10" stroke={color} strokeWidth={3.4} strokeLinecap="round" />
    </>}
  </Svg>;
}
