import { Image, Pressable, Text, View } from 'react-native';

import { merchantArt } from '../collection/merchant-art';
import { useMerchantArtStyles } from './use-merchant-art-styles';

type Props = {
  apiUrl: string;
  merchantId: string;
  /** The art path the owner chose for this merchant, if any. */
  artUrl: string | null;
  onPress: () => void;
};

/** "가게 그림 만들기" card on the owner page: shows the picture customers see now and opens the art screen. */
export function MerchantArtEntryCard({ apiUrl, merchantId, artUrl, onPress }: Props) {
  const styles = useMerchantArtStyles();
  const art = merchantArt({ id: merchantId, artUrl }, apiUrl);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="가게 그림 만들기"
      accessibilityHint={art?.fromServer ? '지금 AI 그림을 쓰고 있어요. 새 그림을 만들거나 기본 그림으로 되돌려요' : 'AI로 가게 그림을 만드는 화면을 열어요'}
      onPress={onPress}
      style={({ pressed }) => [styles.entryCard, pressed ? styles.entryCardPressed : null]}
    >
      <View accessible={false} style={styles.entryThumb}>
        {art ? (
          <Image source={art.source} accessible={false} accessibilityIgnoresInvertColors resizeMode="cover" style={styles.entryThumbImage} />
        ) : (
          <Text accessible={false} style={styles.entryThumbGlyph}>AI</Text>
        )}
      </View>
      <View style={styles.entryCopy}>
        <Text textBreakStrategy="simple" style={styles.entryTitle}>가게 그림 만들기</Text>
        <Text style={styles.entryBody}>
          {art?.fromServer ? '지금 AI 그림을 쓰고 있어요.' : '지금은 기본 그림이에요. AI 시안 4장 중에서 골라 보세요.'}
        </Text>
      </View>
      <Text accessible={false} style={styles.entryChevron}>›</Text>
    </Pressable>
  );
}
