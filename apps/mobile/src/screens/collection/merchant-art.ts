import * as Application from 'expo-application';
import type { ImageSourcePropType } from 'react-native';

import { chooseMerchantArt } from '@/merchant-art/art-source';

// The literal './showcase-collectible-art-assets' is what metro swaps for the .showcase.ts file in the showcase
// variant (metro.config.js). Screens outside this folder import this module, never the art files.
import { showcaseCollectibleArtSource } from './showcase-collectible-art-assets';
import { showcaseCollectibleArtKey } from './showcase-collectible-art';

/** What a merchant's own picture needs: its id and the art path the public catalog gave it, if any. */
export type MerchantArtSubject = { id: string; artUrl?: string | null };

export type MerchantArt = { source: ImageSourcePropType; fromServer: boolean };

/**
 * The picture for a merchant, or undefined so the caller draws the glyph stamp. Order (D-048): the art the owner chose (served
 * by the API at `apiUrl`), then the bundled showcase illustration (demo app, fixed virtual merchants only), then none.
 */
export function merchantArt(merchant: MerchantArtSubject, apiUrl?: string): MerchantArt | undefined {
  const { id: merchantId, artUrl } = merchant;
  const key = showcaseCollectibleArtKey(Application.applicationId, merchantId);
  const chosen = chooseMerchantArt<ImageSourcePropType>({ artUrl, apiUrl, bundled: key ? showcaseCollectibleArtSource(key) : undefined });
  return chosen ? { source: chosen.source, fromServer: chosen.fromServer } : undefined;
}

export function merchantArtSource(merchant: MerchantArtSubject, apiUrl?: string): ImageSourcePropType | undefined {
  return merchantArt(merchant, apiUrl)?.source;
}
