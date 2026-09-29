import * as Application from 'expo-application';
import type { ImageSourcePropType } from 'react-native';

// The literal './showcase-collectible-art-assets' is what metro swaps for the .showcase.ts file in the showcase
// variant (metro.config.js). Screens outside this folder import this module, never the art files.
import { showcaseCollectibleArtSource } from './showcase-collectible-art-assets';
import { showcaseCollectibleArtKey } from './showcase-collectible-art';

/** Illustration for a fixed virtual merchant in the showcase app; undefined for every other merchant and variant. */
export function merchantArtSource(merchantId: string): ImageSourcePropType | undefined {
  const key = showcaseCollectibleArtKey(Application.applicationId, merchantId);
  return key ? showcaseCollectibleArtSource(key) : undefined;
}
