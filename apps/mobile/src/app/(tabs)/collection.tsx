import { useAuthSession } from '@/auth/auth-provider';
import { CollectionScreen } from '@/screens/collection';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { AppHeader } from '@/ui/app-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function CollectionRoute() {
  const auth = useAuthSession();
  // Signed-out and set-up states draw the same sky header as the screen itself, inside their own scroll content.
  const header = <AppHeader title="도감" subtitle="가본 가게마다 도장이 찍혀요" />;
  if (!auth.credential || !auth.accountId) return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
  ];
  if (!publicApiConfig.available) {
    return (
      <SkyBackdrop>
        <SkyScrollView header={header}>
          <DemoConfigurationRequired title="방문 도감 설정이 필요합니다." missing={missing} />
        </SkyScrollView>
      </SkyBackdrop>
    );
  }

  return (
    <CollectionScreen
      key={auth.accountId}
      apiUrl={publicApiConfig.apiUrl}
      accountId={auth.accountId}
      credential={auth.credential}
      onSessionInvalid={auth.invalidateSession}
    />
  );
}
