import { Image, Text, View } from 'react-native';

import type { PublicMerchant } from '@/merchant/merchant-api';

import { stampGlyph } from '../collection/collection-stamps';
import { merchantArtSource } from '../collection/merchant-art';
import { useMerchantListStyles } from './use-merchant-list-styles';

/** Round mark on a merchant card: the owner's AI picture or the showcase illustration when one exists, otherwise the same short glyph as the passport stamp (stampGlyph). */
export function MerchantCrest({ merchant, apiUrl }: { merchant: Pick<PublicMerchant, 'id' | 'name' | 'artUrl'>; apiUrl: string }) {
  const styles = useMerchantListStyles();
  const art = merchantArtSource(merchant, apiUrl);
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.crest}>
      {art ? (
        <Image source={art} accessible={false} accessibilityIgnoresInvertColors resizeMode="cover" style={styles.crestArt} />
      ) : (
        <Text maxFontSizeMultiplier={1.2} style={styles.crestLetter}>{stampGlyph(merchant.name)}</Text>
      )}
    </View>
  );
}
