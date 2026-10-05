import { useLocalSearchParams } from 'expo-router';

import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { MealInviteScreen } from '@/screens/mail/compose';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function MealInviteRoute() {
  const auth = useAuthSession();
  const { friendshipId } = useLocalSearchParams<{ friendshipId?: string }>();
  const header = <BackHeader title="같이 밥 먹기" />;
  if (!auth.credential || !auth.accountId) return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  if (!publicApiConfig.available) {
    return (
      <SkyBackdrop>
        <SkyScrollView header={header}>
          <DemoConfigurationRequired title="식사 초대 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
        </SkyScrollView>
      </SkyBackdrop>
    );
  }
  return (
    <MealInviteScreen
      key={`${auth.accountId}:${friendshipId ?? ''}`}
      apiUrl={publicApiConfig.apiUrl}
      credential={auth.credential}
      onSessionInvalid={auth.invalidateSession}
      friendshipId={friendshipId ?? ''}
    />
  );
}
