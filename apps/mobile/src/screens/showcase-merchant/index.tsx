import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient } from '@/commerce/commerce-api';
import { createMerchantApiClient } from '@/merchant/merchant-api';
import { findShowcaseStaffMerchant } from '@/merchant/showcase-staff';
import { MerchantClaimScreen } from '@/screens/merchant-claim';
import { colorsForScheme } from '@/theme/palette';

type Props = {
  apiUrl: string | undefined;
  accountId: string;
  credential: AccountCredential;
  onBrowse: () => void;
};

export function ShowcaseMerchantScreen({ apiUrl, accountId, credential, onBrowse }: Props) {
  const colors = colorsForScheme(useColorScheme());
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'denied' } | { status: 'error' } |
    { status: 'allowed'; merchantId: string }
  >({ status: 'loading' });
  const client = useMemo(
    () => apiUrl ? createCommerceApiClient({ apiUrl, credential }) : undefined,
    [apiUrl, credential],
  );

  useEffect(() => {
    if (!apiUrl || !client) return;
    let active = true;
    void createMerchantApiClient(apiUrl).listMerchants()
      .then((merchants) => findShowcaseStaffMerchant(
        merchants.filter((merchant) => merchant.demo).map((merchant) => merchant.id),
        client.getMerchantContext,
      ))
      .then((context) => {
        if (active) setState(context
          ? { status: 'allowed', merchantId: context.merchantId }
          : { status: 'denied' });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => { active = false; };
  }, [apiUrl, client, retry]);

  const status = apiUrl ? state.status : 'error';

  if (state.status === 'allowed' && apiUrl) {
    return <MerchantClaimScreen
      apiUrl={apiUrl}
      accountId={accountId}
      merchantId={state.merchantId}
      credential={credential}
    />;
  }

  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 20, padding: 28, backgroundColor: colors.background }}>
    <Text accessibilityRole="header" style={{ color: colors.label, fontSize: 28, fontWeight: '700' }}>점주 체험</Text>
    <Text selectable style={{ color: colors.secondaryLabel, fontSize: 16, lineHeight: 25 }}>
      이 화면은 가상 점포 체험용입니다. 역할 선택만으로 점주 권한이 생기지 않으며, 서버에서 방문 확인 권한을 확인합니다.
    </Text>
    <View accessibilityLiveRegion="polite" style={{ gap: 12 }}>
      {status === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}
      <Text selectable style={{ color: colors.label, fontSize: 16 }}>
        {status === 'loading' ? '점포 권한을 확인하는 중입니다.'
          : status === 'denied' ? '이 계정에는 가상 점포의 방문 확인 권한이 없습니다.'
            : '점포 정보를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'}
      </Text>
    </View>
    {status === 'error' ? <Pressable accessibilityRole="button" onPress={() => { setState({ status: 'loading' }); setRetry((value) => value + 1); }} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>다시 시도</Text>
    </Pressable> : null}
    <Pressable accessibilityRole="button" onPress={onBrowse} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>고객으로 둘러보기</Text>
    </Pressable>
  </ScrollView>;
}
