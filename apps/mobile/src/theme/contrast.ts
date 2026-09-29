/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
export function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const [red, green, blue] = [1, 3, 5].map((index) => {
      const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

const channels = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));

/** The #RRGGBB you see when `foreground` at `alpha` is drawn over an opaque `background`. */
export function blend(foreground: string, background: string, alpha: number): string {
  const back = channels(background);
  const mixed = channels(foreground).map((value, index) => Math.round(value * alpha + back[index]! * (1 - alpha)));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** rgba() string for a #RRGGBB colour at `alpha`. */
export function withAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = channels(hex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Pressed fill for a solid control: move away from the label colour so the label keeps its contrast. */
export function pressedFill(fill: string, label: string): string {
  return blend(contrast(label, '#000000') > contrast(label, '#FFFFFF') ? '#000000' : '#FFFFFF', fill, 0.2);
}
