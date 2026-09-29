import { DEMO_NO_DIRECTIONS, NO_ADDRESS_NO_DIRECTIONS } from './copy';

/** Directions are searches by road address in the person's own map app: the app never asks for or reads a location (D-046). */
export type DirectionsProvider = 'naver' | 'kakao';
export type DirectionsTargets = Record<DirectionsProvider, { app: string; web: string }>;

/** The name Naver Maps shows for the app that opened it; it is the Android application id. */
export const NAVER_APP_NAME = 'kr.masscom.wolgye';

/** `encodeURIComponent` throws on a lone surrogate (a malformed string from the API); that is "nothing to search", not a crash. */
function encodeQuery(text: string): string | null {
  try {
    return encodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * Links that search the merchant's road address in Naver Maps and KakaoMap (app first, web page as the fallback), or null when
 * there is nothing honest to search: a demo merchant's place is virtual, and a blank or unreadable address has no search.
 */
export function directionsTargets(merchant: { roadAddress: string; demo: boolean }): DirectionsTargets | null {
  const address = merchant.roadAddress.trim();
  if (merchant.demo || !address) return null;
  const query = encodeQuery(address);
  if (query === null) return null;
  return {
    naver: { app: `nmap://search?query=${query}&appname=${NAVER_APP_NAME}`, web: `https://map.naver.com/p/search/${query}` },
    kakao: { app: `kakaomap://search?q=${query}`, web: `https://map.kakao.com/?q=${query}` },
  };
}

/** The sentence that takes the place of the directions button, or null when directions are offered. */
export function directionsNotice(merchant: { roadAddress: string; demo: boolean }): string | null {
  if (directionsTargets(merchant)) return null;
  return merchant.demo ? DEMO_NO_DIRECTIONS : NO_ADDRESS_NO_DIRECTIONS;
}

export type ChooserButton = { text: string; style?: 'cancel'; onPress?: () => void };

/**
 * The buttons of the "which map?" alert. Android's dialog reads the list as neutral, negative, positive (left to right), so
 * cancel goes first and the last, most prominent slot is a real choice; iOS keeps a cancel-style button at the bottom anyway.
 */
export function directionsChooserButtons(pick: (provider: DirectionsProvider) => void): ChooserButton[] {
  return [
    { text: '취소', style: 'cancel' },
    { text: '카카오맵', onPress: () => pick('kakao') },
    { text: '네이버 지도', onPress: () => pick('naver') },
  ];
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
