import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { TownMapScreen } from '@/screens/town-map';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { BackHeader } from '@/ui/back-header';

export default function MealMerchantRoute() {
  const auth = useAuthSession();
  const router = useRouter();
  const { friendshipId } = useLocalSearchParams<{ friendshipId?: string }>();
  if (!publicApiConfig.available) {
    return (
      <SkyBackdrop>
        <SkyScrollView header={<BackHeader title="가게 선택" />}>
          <DemoConfigurationRequired title="지도 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
        </SkyScrollView>
      </SkyBackdrop>
    );
  }
  return (
    <TownMapScreen
      key={auth.accountId}
      apiUrl={publicApiConfig.apiUrl}
      credential={auth.credential}
      onSessionInvalid={auth.invalidateSession}
      selectionMode={{
        title: '가게 선택',
        actionLabel: '이 가게로 초대',
        onSelectMerchant: (merchantId) => router.replace({
          pathname: '/friends/[friendshipId]/meal-invite',
          params: { friendshipId: friendshipId ?? '', merchantId },
        }),
      }}
    />
  );
}
