import { publicApiConfig } from '@/config/public-api-runtime';
import { MerchantApiConfigurationRequired, MerchantListScreen } from '@/screens/merchant-list';

export default function MerchantListRoute() {
  if (!publicApiConfig.available) {
    return <MerchantApiConfigurationRequired />;
  }

  return <MerchantListScreen apiUrl={publicApiConfig.apiUrl} />;
}
