import { demoRuntimeConfig } from '@/config/demo-runtime';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { MerchantClaimScreen } from '@/screens/merchant-claim';

export default function MerchantClaimRoute() {
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
    ...(!demoRuntimeConfig.merchant ? ['EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID', 'EXPO_PUBLIC_DEMO_MERCHANT_ID'] : []),
  ];
  if (!publicApiConfig.available || !demoRuntimeConfig.merchant) {
    return <DemoConfigurationRequired title="점주 발급 화면 설정이 필요합니다." missing={missing} />;
  }

  return (
    <MerchantClaimScreen
      apiUrl={publicApiConfig.apiUrl}
      accountId={demoRuntimeConfig.merchant.accountId}
      merchantId={demoRuntimeConfig.merchant.merchantId}
      defaultCustomerAccountId={demoRuntimeConfig.customerAccountId}
    />
  );
}
