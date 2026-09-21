import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { ClaimRedeemScreen } from '@/screens/claim-redeem';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';

export default function ClaimRedeemRoute() {
  const auth = useAuthSession();
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
    ...(!auth.credential ? ['AUTH_SESSION'] : []),
  ];
  if (!publicApiConfig.available || !auth.credential || !auth.accountId) {
    return <DemoConfigurationRequired title="방문 수령 화면 설정이 필요합니다." missing={missing} />;
  }

  return (
    <ClaimRedeemScreen
      key={auth.accountId}
      apiUrl={publicApiConfig.apiUrl}
      credential={auth.credential}
      onSessionInvalid={auth.logout}
    />
  );
}
