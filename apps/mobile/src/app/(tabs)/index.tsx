import { publicApiConfig } from '@/config/public-api-runtime';
import { MerchantApiConfigurationRequired, MerchantListScreen } from '@/screens/merchant-list';
import { AppHeader } from '@/ui/app-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function MerchantListRoute() {
  if (!publicApiConfig.available) {
    // The set-up notice sits under the same sky header as the list itself, inside its own scroll content.
    const header = <AppHeader title="어디로 탐험할까요?" subtitle="안 가본 가게에 도장을 찍어요" />;
    return (
      <SkyBackdrop>
        <SkyScrollView header={header}>
          <MerchantApiConfigurationRequired />
        </SkyScrollView>
      </SkyBackdrop>
    );
  }

  return <MerchantListScreen apiUrl={publicApiConfig.apiUrl} />;
}
