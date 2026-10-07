import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { FriendsScreen } from '@/screens/friends';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function ProfileRoute() {
  const auth = useAuthSession();
  const header = <BackHeader title="내 프로필" />;
  if (!auth.credential || !auth.accountId) return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  if (!publicApiConfig.available) return <SkyBackdrop><SkyScrollView header={header}><DemoConfigurationRequired title="프로필에 API 연결이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} /></SkyScrollView></SkyBackdrop>;
  return <FriendsScreen key={auth.accountId} profileOnly apiUrl={publicApiConfig.apiUrl} credential={auth.credential} onSessionInvalid={auth.invalidateSession} header={header} />;
}
