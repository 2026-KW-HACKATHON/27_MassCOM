import type { ViewStyle } from 'react-native';

// A pressable card wraps its visible card in a Pressable: how the card sits among its siblings belongs on the wrapper.
const OUTER_KEYS = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'width', 'minWidth', 'maxWidth', 'alignSelf',
  'position', 'top', 'right', 'bottom', 'left', 'start', 'end', 'zIndex',
]);

/** Splits a flattened card style into the layout props for the outer wrapper and the visual props for the card itself. */
export function splitCardStyle(style: ViewStyle | undefined): { outer: ViewStyle; inner: ViewStyle } {
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style ?? {})) {
    (OUTER_KEYS.has(key) || key.startsWith('margin') ? outer : inner)[key] = value;
  }
  return { outer: outer as ViewStyle, inner: inner as ViewStyle };
}
