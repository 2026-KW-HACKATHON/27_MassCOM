import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { NotificationCenter } from '@/notifications/center';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { BackHeader } from '@/ui/back-header';

export default function NotificationsRoute() {
  const auth = useAuthSession();
  if (!auth.credential || !auth.accountId) return <AuthRequiredRoute />;
  if (!publicApiConfig.available) return <SkyBackdrop><SkyScrollView header={<BackHeader title="알림함" />}>
    <DemoConfigurationRequired title="알림함에 API 연결이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
  </SkyScrollView></SkyBackdrop>;
  return <NotificationCenter key={auth.accountId} apiUrl={publicApiConfig.apiUrl} credential={auth.credential} onSessionInvalid={auth.invalidateSession} />;
}
