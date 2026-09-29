import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { ClaimRedeemScreen } from '@/screens/claim-redeem';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { AppHeader } from '@/ui/app-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function ClaimRedeemRoute() {
  const auth = useAuthSession();
  // Signed-out and set-up states draw the same sky header as the screen itself, inside their own scroll content.
  const header = <AppHeader title="방문 인증" subtitle="가게에서 도장을 받아요" />;
  if (!auth.credential || !auth.accountId) return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
  ];
  if (!publicApiConfig.available) {
    return (
      <SkyBackdrop>
        <SkyScrollView header={header}>
          <DemoConfigurationRequired title="방문 수령 화면 설정이 필요합니다." missing={missing} />
        </SkyScrollView>
      </SkyBackdrop>
    );
  }

  return (
    <SkyBackdrop>
      <ClaimRedeemScreen
        key={auth.accountId}
        apiUrl={publicApiConfig.apiUrl}
        credential={auth.credential}
        onSessionInvalid={auth.invalidateSession}
      />
    </SkyBackdrop>
  );
}
