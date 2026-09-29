import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { ClaimRedeemScreen } from '@/screens/claim-redeem';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { AppHeader } from '@/ui/app-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';

export default function ClaimRedeemRoute() {
  const auth = useAuthSession();
  if (!auth.credential || !auth.accountId) return <AuthRequiredRoute />;
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
  ];
  if (!publicApiConfig.available) {
    return <DemoConfigurationRequired title="방문 수령 화면 설정이 필요합니다." missing={missing} />;
  }

  return (
    <SkyBackdrop>
      <AppHeader title="방문 인증" subtitle="가게에서 도장을 받아요" />
      <ClaimRedeemScreen
        key={auth.accountId}
        apiUrl={publicApiConfig.apiUrl}
        credential={auth.credential}
        onSessionInvalid={auth.invalidateSession}
      />
    </SkyBackdrop>
  );
}
