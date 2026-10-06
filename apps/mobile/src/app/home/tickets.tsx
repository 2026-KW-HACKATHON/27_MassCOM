import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { HomeTicketsScreen } from '@/screens/home/home-tickets';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function HomeTicketsRoute() {
  const auth = useAuthSession();
  const header = <BackHeader title="받은 가게권" />;
  if (!auth.credential || !auth.accountId) return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  if (!publicApiConfig.available) {
    return <SkyBackdrop><SkyScrollView header={header}>
      <DemoConfigurationRequired title="가게권 화면 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
    </SkyScrollView></SkyBackdrop>;
  }
  return <HomeTicketsScreen key={auth.accountId} apiUrl={publicApiConfig.apiUrl}
    credential={auth.credential} onSessionInvalid={auth.invalidateSession} />;
}
