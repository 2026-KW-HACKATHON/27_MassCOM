import { getAppPackageId } from '@/config/app-identity';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';

import { useAuthSession } from '@/auth/auth-provider';
import { demoRuntimeConfig } from '@/config/demo-runtime';
import { publicApiConfig } from '@/config/public-api-runtime';
import { canOpenDeveloperMerchantRoute } from '@/navigation/showcase-entry';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { MerchantClaimScreen } from '@/screens/merchant-claim';

export default function MerchantClaimRoute() {
  const auth = useAuthSession();
  if (!canOpenDeveloperMerchantRoute(getAppPackageId(), auth.credential, demoRuntimeConfig)) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 }}>
      <Text>이 계정에서는 개발용 점주 발급 화면을 사용할 수 없습니다.</Text>
      <Link href="/">음식점 탐색으로 돌아가기</Link>
    </View>;
  }
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
    ...(!demoRuntimeConfig.merchant ? ['EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID', 'EXPO_PUBLIC_DEMO_MERCHANT_ID'] : []),
  ];
  if (!publicApiConfig.available || !demoRuntimeConfig.merchant) {
    return <DemoConfigurationRequired title="점주 발급 화면 설정이 필요합니다." missing={missing} />;
  }

  return (
    <MerchantClaimScreen
      key={demoRuntimeConfig.merchant.accountId}
      apiUrl={publicApiConfig.apiUrl}
      accountId={demoRuntimeConfig.merchant.accountId}
      merchantId={demoRuntimeConfig.merchant.merchantId}
      defaultCustomerAccountId={demoRuntimeConfig.customerAccountId}
    />
  );
}
