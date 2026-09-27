import { useAuthSession } from '@/auth/auth-provider';
import { CollectionScreen } from '@/screens/collection';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { AuthRequiredRoute } from '@/screens/auth-required/route';

export default function CollectionRoute() {
  const auth = useAuthSession();
  if (!auth.credential || !auth.accountId) return <AuthRequiredRoute />;
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
  ];
  if (!publicApiConfig.available) {
    return <DemoConfigurationRequired title="방문 도감 설정이 필요합니다." missing={missing} />;
  }

  return (
    <CollectionScreen
      key={auth.accountId}
      apiUrl={publicApiConfig.apiUrl}
      credential={auth.credential}
      onSessionInvalid={auth.invalidateSession}
    />
  );
}
