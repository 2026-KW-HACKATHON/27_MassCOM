import { useLocalSearchParams } from 'expo-router';

import { publicApiConfig } from '@/config/public-api-runtime';
import { MerchantApiConfigurationRequired } from '@/screens/merchant-list';
import { MerchantDetailScreen } from '@/screens/merchant-detail';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function MerchantDetailRoute() {
  const { merchantId, from } = useLocalSearchParams<{ merchantId?: string; from?: string }>();

  if (!publicApiConfig.available) {
    // The native stack header is hidden for this page, so even this state keeps a way back.
    return (
      <SkyBackdrop>
        <SkyScrollView header={<BackHeader title="음식점 상세" />}>
          <MerchantApiConfigurationRequired />
        </SkyScrollView>
      </SkyBackdrop>
    );
  }

  return <MerchantDetailScreen merchantId={merchantId ?? ''} apiUrl={publicApiConfig.apiUrl} from={from} />;
}
