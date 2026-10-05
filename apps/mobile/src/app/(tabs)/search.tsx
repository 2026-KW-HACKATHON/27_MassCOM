import { publicApiConfig } from '@/config/public-api-runtime';
import { MerchantApiConfigurationRequired, MerchantListScreen } from '@/screens/merchant-list';
import { AppHeader } from '@/ui/app-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function MerchantListRoute() {
  if (!publicApiConfig.available) {
    // The set-up notice sits under the same sky header as the list itself, inside its own scroll content.
    const header = <AppHeader title="가게 검색" subtitle="이름·메뉴·주소로 찾고 지도로도 볼 수 있어요" />;
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
