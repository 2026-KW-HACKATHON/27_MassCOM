import { Image, Text, View } from 'react-native';

import type { PublicMerchant } from '@/merchant/merchant-api';

import { merchantArtSource } from '../collection/merchant-art';
import { useMerchantListStyles } from './use-merchant-list-styles';

/** Round mark on a merchant card: the showcase illustration when one exists, otherwise the name's first letter as an ink stamp. */
export function MerchantCrest({ merchant }: { merchant: Pick<PublicMerchant, 'id' | 'name'> }) {
  const styles = useMerchantListStyles();
  const art = merchantArtSource(merchant.id);
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.crest}>
      {art ? (
        <Image source={art} accessible={false} accessibilityIgnoresInvertColors resizeMode="cover" style={styles.crestArt} />
      ) : (
        <Text maxFontSizeMultiplier={1.2} style={styles.crestLetter}>{Array.from(merchant.name)[0] ?? '·'}</Text>
      )}
    </View>
  );
}
