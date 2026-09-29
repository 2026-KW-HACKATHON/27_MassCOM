import { View } from 'react-native';

import type { FriendMedal } from '@/friends/friends-api';
import { MedalGlyph } from '@/gamification/glyphs';
import { useGamificationTheme } from '@/gamification/theme';
import { tierColors } from '@/theme/medal-colors';

const DOT = 24;

/**
 * Three small coins, one per medal in the fixed order (탐험가 · 단골 · 꾸준한 걸음): metal-coloured with the medal's mark when
 * earned, a dashed grey ring when not. Decorative; the row it sits in says every tier in words for screen readers.
 */
export function TierDots({ medals }: { medals: readonly FriendMedal[] }) {
  const { medal: colors } = useGamificationTheme();
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: 4 }}>
      {medals.map((medal) => {
        const metal = medal.tier > 0 ? tierColors(colors, medal.tier as 1 | 2 | 3) : null;
        return (
          <View
            key={medal.key}
            style={{
              width: DOT, height: DOT, borderRadius: DOT / 2, alignItems: 'center', justifyContent: 'center',
              borderWidth: 2, borderStyle: metal ? 'solid' : 'dashed',
              borderColor: metal ? metal.edge : colors.lockedEdge,
              backgroundColor: metal ? metal.shade : colors.lockedFill,
            }}
          >
            <MedalGlyph kind={medal.key} size={12} color={metal ? '#FFFFFF' : colors.lockedEdge} />
          </View>
        );
      })}
    </View>
  );
}
