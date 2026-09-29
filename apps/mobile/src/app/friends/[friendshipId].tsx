import { useLocalSearchParams } from 'expo-router';

import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { FriendPassportScreen } from '@/screens/friends/passport';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function FriendPassportRoute() {
  const auth = useAuthSession();
  const { friendshipId } = useLocalSearchParams<{ friendshipId?: string }>();
  // The native stack header is hidden for this page, so every state carries its own way back inside its scroll content.
  const header = <BackHeader title="친구 여권" />;
  if (!auth.credential || !auth.accountId) {
    return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  }
  if (!publicApiConfig.available) {
    return (
      <SkyBackdrop>
        <SkyScrollView header={header}>
          <DemoConfigurationRequired title="친구 여권 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
        </SkyScrollView>
      </SkyBackdrop>
    );
  }

  return (
    <FriendPassportScreen
      key={`${auth.accountId}:${friendshipId ?? ''}`}
      apiUrl={publicApiConfig.apiUrl}
      credential={auth.credential}
      onSessionInvalid={auth.invalidateSession}
      friendshipId={friendshipId ?? ''}
    />
  );
}
