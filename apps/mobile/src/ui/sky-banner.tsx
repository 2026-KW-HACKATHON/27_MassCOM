import { View, useWindowDimensions } from 'react-native';

import { SkyArt } from './sky-art';
import { compactArtHeight } from './sky-art-size';

/** Sky header for a page with no title row of its own (sign-in, consent): the compact town art, scrolling away with the content. */
export function SkyBanner() {
  const { width } = useWindowDimensions();
  return (
    <View style={{ minHeight: compactArtHeight(width), marginBottom: 8 }}>
      <SkyArt compact />
    </View>
  );
}
