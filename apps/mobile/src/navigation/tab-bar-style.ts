import type { TextStyle, ViewStyle } from 'react-native';

import type { AppColors } from '../theme/palette';
import type { WorldTheme } from '../theme/world';

/**
 * Selected and unselected tabs used to differ only by icon/label colour (about 1.05:1 apart), which fails WCAG 1.4.1.
 * The selected tab now also gets a filled pill behind its icon and a bolder label; the raised claim stamp gets a ring.
 */
export function tabIndicator(selected: boolean, palette: AppColors, world: WorldTheme) {
  const color = selected ? world.tabActive : world.tabInactive;
  return {
    iconColor: color,
    pill: {
      width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
      backgroundColor: selected ? palette.primaryContainer : 'transparent',
    } satisfies ViewStyle,
    label: { color, fontWeight: selected ? '800' : '500' } satisfies TextStyle,
    // Drawn inside the primary disc of the claim stamp, so it is judged against the disc fill.
    claimRing: selected
      ? ({
        position: 'absolute', top: 3, right: 3, bottom: 3, left: 3, borderRadius: 999, borderWidth: 2, borderColor: palette.onPrimary,
      } satisfies ViewStyle)
      : null,
  };
}

/**
 * Bar height by text size. The raised 64dp claim button leaves `height - 48` for its label under it (LIFT 22 - button 64,
 * a 2dp gap and a 4dp margin), and the label grows to 1.5x, so a 64dp bar only fits up to about 1.15x.
 */
export function barHeightFor(fontScale: number): number {
  if (fontScale >= 1.5) return 76;
  return fontScale >= 1.15 ? 72 : 64;
}

/**
 * With four slots (탐색 · 지도 · 방문 인증 · 도감) the raised claim stamp is the third. Its slot is a little wider than the others
 * so the "방문 인증" label, four glyphs and a space at the 1.5x cap, still fits on a 320dp phone.
 */
export const CLAIM_SLOT_FLEX = 1.2;
