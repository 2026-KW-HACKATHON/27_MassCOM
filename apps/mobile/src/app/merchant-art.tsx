import * as Application from 'expo-application';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { canOpenMerchantArtRoute } from '@/navigation/showcase-entry';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { MerchantArtScreen } from '@/screens/merchant-art';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

/**
 * The owner art page as a stack route (`/merchant-art?merchantId=...`), for the showcase app and the local development build
 * (which checks the flow against a local API). The operating app never opens it. The showcase owner page itself replaces the
 * navigator and opens the same screen in place; either way the server checks that the account may manage this merchant's art,
 * so the merchant id in the address grants nothing.
 */
export default function MerchantArtRoute() {
  const auth = useAuthSession();
  const router = useRouter();
  const { merchantId } = useLocalSearchParams<{ merchantId?: string }>();
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const frame = (body: ReactNode) => (
    <SkyBackdrop>
      <SkyScrollView header={<BackHeader title="가게 그림 만들기" />}>
        <View style={{ paddingHorizontal: 20 }}>{body}</View>
      </SkyScrollView>
    </SkyBackdrop>
  );

  if (!canOpenMerchantArtRoute(Application.applicationId)) {
    return frame(<StateScene kind="empty" title="이 앱에서는 열 수 없어요" body="가게 그림 만들기는 시연 앱의 점주 화면과 로컬 개발 빌드에서만 쓸 수 있어요." />);
  }
  if (!auth.credential || !auth.accountId) {
    return frame(<StateScene kind="error" title="로그인이 필요해요" body="점주 계정으로 로그인한 뒤 다시 열어 주세요." />);
  }
  if (!publicApiConfig.available) {
    return frame(<DemoConfigurationRequired title="가게 그림 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />);
  }
  if (!merchantId) {
    return frame(<StateScene kind="empty" title="가게를 찾을 수 없어요" body="점주 화면에서 가게 그림 만들기를 눌러 주세요." />);
  }

  return (
    <MerchantArtScreen
      key={`${auth.accountId}:${merchantId}`}
      apiUrl={publicApiConfig.apiUrl}
      merchantId={merchantId}
      credential={auth.credential}
      onSessionInvalid={auth.invalidateSession}
      onBack={goBack}
      focused={focused}
    />
  );
}
