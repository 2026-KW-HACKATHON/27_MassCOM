import { demoRuntimeConfig } from '@/config/demo-runtime';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { RecommendationsScreen } from '@/screens/recommendations';

export default function RecommendationsRoute() {
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
    ...(!demoRuntimeConfig.customerAccountId ? ['EXPO_PUBLIC_DEMO_ACCOUNT_ID'] : []),
  ];
  if (!publicApiConfig.available || !demoRuntimeConfig.customerAccountId) {
    return <DemoConfigurationRequired title="다음 가게 추천 설정이 필요합니다." missing={missing} />;
  }

  return <RecommendationsScreen key={demoRuntimeConfig.customerAccountId} apiUrl={publicApiConfig.apiUrl} accountId={demoRuntimeConfig.customerAccountId} />;
}
