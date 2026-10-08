import * as ReactNativeWeb from 'react-native-web';
export * from 'react-native-web';

export function useWindowDimensions() {
  const dimensions = ReactNativeWeb.useWindowDimensions();
  const params = new URLSearchParams(window.location.search);
  const requestedFontScale = Number(params.get('fontScale'));
  return Number.isFinite(requestedFontScale) && requestedFontScale > 0
    ? { ...dimensions, fontScale: requestedFontScale }
    : dimensions;
}
