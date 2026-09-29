import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { RecommendationsScreen } from '@/screens/recommendations';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function RecommendationsRoute() {
  const auth = useAuthSession();
  // The native stack header is hidden for this page, so every state carries its own way back inside its scroll content.
  const header = <BackHeader title="다음 가게 추천" />;
  if (!auth.credential || !auth.accountId) {
    return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  }
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
  ];
  if (!publicApiConfig.available) {
    return (
      <SkyBackdrop>
        <SkyScrollView header={header}>
          <DemoConfigurationRequired title="다음 가게 추천 설정이 필요합니다." missing={missing} />
        </SkyScrollView>
      </SkyBackdrop>
    );
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
