import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient } from '@/commerce/commerce-api';
import { createMerchantApiClient } from '@/merchant/merchant-api';
import { findShowcaseStaffMerchant } from '@/merchant/showcase-staff';
import { MerchantArtScreen } from '@/screens/merchant-art';
import { MerchantArtEntryCard } from '@/screens/merchant-art/entry-card';
import { StaffClaimScreen } from '@/screens/merchant-claim/staff';
import { FoundationScreen } from '@/screens/foundation';
import { colorsForScheme } from '@/theme/palette';

type Props = {
  apiUrl: string | undefined;
  accountId: string;
  credential: AccountCredential;
  onBrowse: () => void;
  onLogout: () => Promise<void>;
  onSessionInvalid: () => Promise<void>;
};

export function ShowcaseMerchantScreen({ apiUrl, accountId, credential, onBrowse, onLogout, onSessionInvalid }: Props) {
  const colors = colorsForScheme(useColorScheme());
  const [retry, setRetry] = useState(0);
  const [tour, setTour] = useState(false);
  const [artOpen, setArtOpen] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'denied' } | { status: 'error' } |
    { status: 'allowed'; merchantId: string; artUrl: string | null }
  >({ status: 'loading' });
  // The art screen reports the picture customers see, so the owner page's card follows an apply or a reset without another fetch.
  const syncArtUrl = useCallback((artUrl: string | null) => {
    setState((current) => (current.status === 'allowed' && current.artUrl !== artUrl ? { ...current, artUrl } : current));
  }, []);
  const client = useMemo(
    () => apiUrl ? createCommerceApiClient({ apiUrl, credential, onSessionInvalid }) : undefined,
    [apiUrl, credential, onSessionInvalid],
  );

  useEffect(() => {
    if (tour || state.status !== 'allowed') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (artOpen) setArtOpen(false);
      else onBrowse();
      return true;
    });
    return () => subscription.remove();
  }, [artOpen, onBrowse, state.status, tour]);

  useEffect(() => {
    if (!apiUrl || !client) return;
    let active = true;
    void createMerchantApiClient(apiUrl).listMerchants()
      .then(async (merchants) => {
        const demoMerchants = merchants.filter((merchant) => merchant.demo);
        const context = await findShowcaseStaffMerchant(demoMerchants.map((merchant) => merchant.id), client.getMerchantContext);
        return context
          ? { merchantId: context.merchantId, artUrl: demoMerchants.find((merchant) => merchant.id === context.merchantId)?.artUrl ?? null }
          : undefined;
      })
      .then((allowed) => {
        if (active) setState(allowed ? { status: 'allowed', ...allowed } : { status: 'denied' });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => { active = false; };
  }, [apiUrl, client, retry]);

  const status = apiUrl ? state.status : 'error';

  if (tour) return <FoundationScreen initialRole="merchant" showcaseTour onExit={() => setTour(false)} />;

  // The art page replaces this page like the tour does: this screen takes over the navigator, so there is no stack to push onto.
  if (artOpen && state.status === 'allowed' && apiUrl) {
    return <MerchantArtScreen
      apiUrl={apiUrl}
      merchantId={state.merchantId}
      credential={credential}
      onSessionInvalid={onSessionInvalid}
      onBack={() => setArtOpen(false)}
      onCurrentArtChange={syncArtUrl}
    />;
  }

  if (state.status === 'allowed' && apiUrl) {
    return <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20, paddingTop: 12 }}>
        <Pressable accessibilityRole="button" onPress={onBrowse} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>고객 탐색으로</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setTour(true)} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>빈 공간 투어</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void onLogout().catch(() => setLogoutError(true))} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>로그아웃</Text>
        </Pressable>
      </View>
      {logoutError ? <Text accessibilityLiveRegion="polite" style={{ paddingHorizontal: 20, color: colors.label }}>로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.</Text> : null}
      <StaffClaimScreen
        apiUrl={apiUrl}
        merchantId={state.merchantId}
        credential={credential}
        onSessionInvalid={onSessionInvalid}
        topSlot={<MerchantArtEntryCard apiUrl={apiUrl} merchantId={state.merchantId} artUrl={state.artUrl} onPress={() => setArtOpen(true)} />}
      />
    </View>;
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
