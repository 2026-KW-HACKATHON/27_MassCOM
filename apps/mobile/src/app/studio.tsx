import { useLocalSearchParams } from 'expo-router';

import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { StudioScreen } from '@/screens/studio';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function StudioRoute() {
  const auth = useAuthSession();
  const { entitlement, avatar } = useLocalSearchParams<{ entitlement?: string | string[]; avatar?: string | string[] }>();
  const header = <BackHeader title="내 공간" />;
  if (!auth.credential || !auth.accountId) return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  if (!publicApiConfig.available) return <SkyBackdrop><SkyScrollView header={header}>
    <DemoConfigurationRequired title="내 공간 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
  </SkyScrollView></SkyBackdrop>;
  return <StudioScreen key={auth.accountId} apiUrl={publicApiConfig.apiUrl} credential={auth.credential}
    onSessionInvalid={auth.invalidateSession} requestedEntitlement={typeof entitlement === 'string' ? entitlement : undefined}
    requestedAvatar={typeof avatar === 'string' ? avatar : undefined} />;
}
