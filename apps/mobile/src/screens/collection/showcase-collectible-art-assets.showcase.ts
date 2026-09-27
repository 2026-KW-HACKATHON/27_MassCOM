import type { ImageSourcePropType } from 'react-native';

import type { ShowcaseCollectibleArtKey } from './showcase-collectible-art';

const art = {
  a: require('../../../assets/images/collectibles/showcase-a.png'),
  b: require('../../../assets/images/collectibles/showcase-b.png'),
  c: require('../../../assets/images/collectibles/showcase-c.png'),
} as const;

export function showcaseCollectibleArtSource(key: ShowcaseCollectibleArtKey): ImageSourcePropType {
  return art[key];
}
