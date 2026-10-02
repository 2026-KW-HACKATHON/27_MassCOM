import { getAppPackageId } from '@/config/app-identity';
import { Alert, Share } from 'react-native';

import { linkVariantFor } from './link';
import { merchantShareMessage } from './recommend';

/**
 * "친구에게 추천": hands the shop name and its link to the system share sheet. Nothing is sent by this app itself, and nothing
 * about the sender's visits goes with it.
 */
export async function recommendMerchant(merchant: { id: string; name: string; demo: boolean }): Promise<void> {
  try {
    await Share.share({ message: merchantShareMessage(merchant, linkVariantFor(getAppPackageId())) });
  } catch {
    Alert.alert('공유창을 열지 못했어요', '잠시 뒤에 다시 눌러 주세요.');
  }
}
