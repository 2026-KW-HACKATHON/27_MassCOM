import { getAppPackageId } from '@/config/app-identity';
import { Link, Stack } from 'expo-router';
import { Pressable, StyleSheet, Text, useColorScheme } from 'react-native';

import { useAuthSession } from '@/auth/auth-provider';
import { demoRuntimeConfig } from '@/config/demo-runtime';
import { publicApiConfig } from '@/config/public-api-runtime';
import { canOpenDeveloperMerchantRoute } from '@/navigation/showcase-entry';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { makeAuthRequiredStyles } from '@/screens/auth-required/styles';
import { MerchantClaimScreen } from '@/screens/merchant-claim';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function MerchantClaimRoute() {
  const auth = useAuthSession();
  const styles = StyleSheet.create(makeAuthRequiredStyles(colorsForScheme(useColorScheme()), StyleSheet.hairlineWidth));
  if (!canOpenDeveloperMerchantRoute(getAppPackageId(), auth.credential, demoRuntimeConfig)) {
    return <SkyBackdrop>
      <Stack.Screen options={{ headerShown: false }} />
      <SkyScrollView header={<BackHeader title="점주 방문 확인" />} contentContainerStyle={styles.content}>
        <FloatingCard style={styles.statusCard}>
          <Text style={styles.statusTitle}>이 계정에서는 개발용 점주 발급 화면을 사용할 수 없습니다.</Text>
        </FloatingCard>
        <Link href="/" asChild>
          <Pressable accessibilityRole="button" style={styles.guestButton}>
            <Text style={styles.guestButtonLabel}>음식점 탐색으로 돌아가기</Text>
          </Pressable>
        </Link>
      </SkyScrollView>
    </SkyBackdrop>;
  }
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
    ...(!demoRuntimeConfig.merchant ? ['EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID', 'EXPO_PUBLIC_DEMO_MERCHANT_ID'] : []),
  ];
  if (!publicApiConfig.available || !demoRuntimeConfig.merchant) {
    return <>
      <Stack.Screen options={{ headerShown: true }} />
      <DemoConfigurationRequired title="점주 발급 화면 설정이 필요합니다." missing={missing} />
    </>;
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true }} />
      <MerchantClaimScreen
        key={demoRuntimeConfig.merchant.accountId}
        apiUrl={publicApiConfig.apiUrl}
        accountId={demoRuntimeConfig.merchant.accountId}
        merchantId={demoRuntimeConfig.merchant.merchantId}
        defaultCustomerAccountId={demoRuntimeConfig.customerAccountId}
      />
    </>
  );
}
