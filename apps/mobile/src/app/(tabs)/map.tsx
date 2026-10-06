import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { RealMapScreen } from '@/screens/real-map';
import { TOWN_MAP_DISCLOSURE, TOWN_MAP_TITLE } from '@/screens/town-map/copy';
import { useTownMapStyles } from '@/screens/town-map/use-town-map-styles';
import { AppHeader } from '@/ui/app-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function TownMapRoute() {
  const auth = useAuthSession();
  const router = useRouter();
  const styles = useTownMapStyles();
  const header = (
    <AppHeader title={TOWN_MAP_TITLE} subtitle={TOWN_MAP_DISCLOSURE}>
      <Pressable accessibilityRole="button" accessibilityLabel="홈으로" onPress={() => router.replace('/')} style={styles.retry}>
        <Text style={styles.retryText}>홈으로</Text>
      </Pressable>
    </AppHeader>
  );
  if (!publicApiConfig.available) {
    // The set-up notice sits under the same sky header as the map itself, inside its own scroll content.
    return (
      <SkyBackdrop>
        <SkyScrollView header={header}>
          <DemoConfigurationRequired title="동네 지도 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
        </SkyScrollView>
      </SkyBackdrop>
    );
  }

  // The public shop list needs no sign-in; stamps appear when there is an account.
  return (
    <RealMapScreen
      key={auth.accountId}
      apiUrl={publicApiConfig.apiUrl}
      credential={auth.credential}
      onSessionInvalid={auth.invalidateSession}
    />
  );
}
