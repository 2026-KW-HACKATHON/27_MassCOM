import { demoRuntimeConfig } from '@/config/demo-runtime';
import { publicApiConfig } from '@/config/public-api-runtime';
import { ClaimRedeemScreen } from '@/screens/claim-redeem';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';

export default function ClaimRedeemRoute() {
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
    ...(!demoRuntimeConfig.customerAccountId ? ['EXPO_PUBLIC_DEMO_ACCOUNT_ID'] : []),
  ];
  if (!publicApiConfig.available || !demoRuntimeConfig.customerAccountId) {
    return <DemoConfigurationRequired title="방문 수령 화면 설정이 필요합니다." missing={missing} />;
  }

  return <ClaimRedeemScreen apiUrl={publicApiConfig.apiUrl} accountId={demoRuntimeConfig.customerAccountId} />;
}
