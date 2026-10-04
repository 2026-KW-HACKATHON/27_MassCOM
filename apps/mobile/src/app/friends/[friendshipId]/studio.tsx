import { useLocalSearchParams } from 'expo-router';

import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { FriendStudioScreen } from '@/screens/studio/friend';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function FriendStudioRoute() {
  const auth = useAuthSession();
  const { friendshipId } = useLocalSearchParams<{ friendshipId?: string }>();
  const header = <BackHeader title="친구 공간" />;
  if (!auth.credential || !auth.accountId) return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  if (!publicApiConfig.available) return <SkyBackdrop><SkyScrollView header={header}>
    <DemoConfigurationRequired title="친구 공간 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
  </SkyScrollView></SkyBackdrop>;
  return <FriendStudioScreen key={`${auth.accountId}:${friendshipId ?? ''}`} apiUrl={publicApiConfig.apiUrl}
    credential={auth.credential} onSessionInvalid={auth.invalidateSession} friendshipId={friendshipId ?? ''} />;
}
