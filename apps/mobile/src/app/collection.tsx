import { CollectionScreen } from '@/screens/collection';
import { demoRuntimeConfig } from '@/config/demo-runtime';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';

export default function CollectionRoute() {
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
    ...(!demoRuntimeConfig.customerAccountId ? ['EXPO_PUBLIC_DEMO_ACCOUNT_ID'] : []),
  ];
  if (!publicApiConfig.available || !demoRuntimeConfig.customerAccountId) {
    return <DemoConfigurationRequired title="방문 도감 설정이 필요합니다." missing={missing} />;
  }

  return <CollectionScreen apiUrl={publicApiConfig.apiUrl} accountId={demoRuntimeConfig.customerAccountId} />;
}
