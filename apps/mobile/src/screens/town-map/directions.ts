/** Directions are searches by road address in the person's own map app: the app never asks for or reads a location (D-046). */
export type DirectionsProvider = 'naver' | 'kakao';
export type DirectionsTargets = Record<DirectionsProvider, { app: string; web: string }>;

/** The name Naver Maps shows for the app that opened it; it is the Android application id. */
export const NAVER_APP_NAME = 'kr.masscom.wolgye';

/**
 * Links that search the merchant's road address in Naver Maps and KakaoMap (app first, web page as the fallback), or null when
 * there is nothing honest to search: a demo merchant's place is virtual, and a blank address has no search.
 */
export function directionsTargets(merchant: { roadAddress: string; demo: boolean }): DirectionsTargets | null {
  const address = merchant.roadAddress.trim();
  if (merchant.demo || !address) return null;
  const query = encodeURIComponent(address);
  return {
    naver: { app: `nmap://search?query=${query}&appname=${NAVER_APP_NAME}`, web: `https://map.naver.com/p/search/${query}` },
    kakao: { app: `kakaomap://search?q=${query}`, web: `https://map.kakao.com/?q=${query}` },
  };
}

export type UrlOpener = (url: string) => Promise<unknown>;

// react-native is loaded only when a link is really opened, so the link logic above and its tests never need the native module.
const openWithLinking: UrlOpener = async (url) => {
  const { Linking } = await import('react-native');
  return Linking.openURL(url);
};

/**
 * Opens the chosen map app. `Linking.openURL` rejects when no app handles the link (checking first with `canOpenURL` would need
 * an Android package-visibility declaration), so a rejection is the cue to open the web page instead.
 * Resolves false when neither opens, so the caller can say so.
 */
export async function openDirections(
  targets: DirectionsTargets,
  provider: DirectionsProvider,
  open: UrlOpener = openWithLinking,
): Promise<boolean> {
  const { app, web } = targets[provider];
  try {
    await open(app);
    return true;
  } catch {
    // The app is not installed (or refused the link): the web page is the honest fallback.
  }
  try {
    await open(web);
    return true;
  } catch {
    return false;
  }
}
