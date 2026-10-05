/** Normalized composition shared by the live scene and export request. Native consumes these request values. */
export const studioComposition = { coinSizeRatio: .30, coinCenterX: .235, coinCenterY: .23, avatarLeft: .285, avatarFloor: .83, avatarWidth: .43, avatarHeight: .46 } as const;

/** Atlas objects keep their real role: hanging art, standing furniture, or a serving tray. */
export function studioDecorPlacement(id: string) {
  if (id === 'bronze-decor') return { surface: 'table', left: .035, anchorY: .705, size: .22, paintedBase: .924 } as const;
  if (id === 'steady-gold-decor' || id === 'silver-decor' || id === 'order-sign') {
    return { surface: 'floor', left: .035, anchorY: .955, size: .23, paintedBase: 1 } as const;
  }
  return { surface: 'wall', left: .76, anchorY: .16, size: .15, paintedBase: 0 } as const;
}
