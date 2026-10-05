import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { HomeScreen } from '@/screens/home';
import { AppHeader } from '@/ui/app-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function HomeRoute() {
  const auth = useAuthSession();
  const header = <AppHeader title="홈" subtitle="오늘 받은 가게권과 미션을 확인해요" />;
  if (!auth.credential || !auth.accountId) return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  if (!publicApiConfig.available) {
    return (
      <SkyBackdrop>
        <SkyScrollView header={header}>
          <DemoConfigurationRequired title="홈 화면 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
        </SkyScrollView>
      </SkyBackdrop>
    );
  }

  return (
    <HomeScreen
      key={auth.accountId}
      apiUrl={publicApiConfig.apiUrl}
      accountId={auth.accountId}
      credential={auth.credential}
      onSessionInvalid={auth.invalidateSession}
    />
  );
}
