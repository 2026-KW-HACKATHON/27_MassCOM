import { useNavigation } from 'expo-router';
import { useCallback } from 'react';
import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { PlayScreen } from '@/screens/play';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { AppHeader } from '@/ui/app-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function PlayTabRoute() {
  const auth = useAuthSession();
  const navigation = useNavigation();
  const onGamePlayingChanged = useCallback((playing: boolean) => {
    navigation.setParams({ runningGame: playing } as never);
  }, [navigation]);
  const header = <AppHeader title="놀이" subtitle="멈춰서 즐기는 동네 놀이" compact />;
  if (!auth.credential || !auth.accountId) return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  if (!publicApiConfig.available) return <SkyBackdrop><SkyScrollView header={header}>
    <DemoConfigurationRequired title="놀이 화면 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
  </SkyScrollView></SkyBackdrop>;
  return <PlayScreen key={auth.accountId} apiUrl={publicApiConfig.apiUrl} credential={auth.credential}
    onSessionInvalid={auth.invalidateSession} tabRoot onGamePlayingChanged={onGamePlayingChanged} />;
}
