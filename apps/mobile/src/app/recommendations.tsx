import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { RecommendationsScreen } from '@/screens/recommendations';

export default function RecommendationsRoute() {
  const auth = useAuthSession();
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
    ...(!auth.credential ? ['AUTH_SESSION'] : []),
  ];
  if (!publicApiConfig.available || !auth.credential || !auth.accountId) {
    return <DemoConfigurationRequired title="다음 가게 추천 설정이 필요합니다." missing={missing} />;
  }

  return (
    <RecommendationsScreen
      key={auth.accountId}
      apiUrl={publicApiConfig.apiUrl}
      credential={auth.credential}
      onSessionInvalid={auth.invalidateSession}
    />
  );
}
