import { useLocalSearchParams } from 'expo-router';

import { publicApiConfig } from '@/config/public-api-runtime';
import { MerchantApiConfigurationRequired } from '@/screens/merchant-list';
import { MerchantDetailScreen } from '@/screens/merchant-detail';

export default function MerchantDetailRoute() {
  const { merchantId } = useLocalSearchParams<{ merchantId?: string }>();

  if (!publicApiConfig.available) {
    return <MerchantApiConfigurationRequired />;
  }

  return <MerchantDetailScreen merchantId={merchantId ?? ''} apiUrl={publicApiConfig.apiUrl} />;
}
