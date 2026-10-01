import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';
import { CommerceApiError, createCommerceApiClient, type ShowcaseAccessRequest } from '@/commerce/commerce-api';
import { createMerchantApiClient } from '@/merchant/merchant-api';
import { findShowcaseStaffMerchant } from '@/merchant/showcase-staff';
import { MerchantArtScreen } from '@/screens/merchant-art';
import { MerchantArtEntryCard } from '@/screens/merchant-art/entry-card';
import { StaffClaimScreen } from '@/screens/merchant-claim/staff';
import { FoundationScreen } from '@/screens/foundation';
import { ShowcaseAccessAdminScreen } from '@/screens/showcase-access-admin';
import { ACCESS_CONTACT_ADDRESSES, accessMailtoUrl, accessUiState, requestAccessFailureMessage } from '@/showcase/access-copy';
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
  const [adminOpen, setAdminOpen] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'denied' } | { status: 'error' } |
    { status: 'allowed'; merchantId: string; artUrl: string | null }
  >({ status: 'loading' });
  // 권한 요청 상태(#294). 점주 체험 가능 여부와 별개로 읽는다: 거부 화면의 문의 흐름과, 두 상태 모두에서 보이는 승인자 메뉴가 이 값을 쓴다.
  const [access, setAccess] = useState<
    { status: 'loading' } | { status: 'error' } |
    { status: 'ready'; request: ShowcaseAccessRequest | null; approver: boolean }
  >({ status: 'loading' });
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const [mailFallback, setMailFallback] = useState(false);
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
    void Promise.all([
      createMerchantApiClient(apiUrl).listMerchants()
        .then(async (merchants) => {
          const demoMerchants = merchants.filter((merchant) => merchant.demo);
          const context = await findShowcaseStaffMerchant(demoMerchants.map((merchant) => merchant.id), client.getMerchantContext);
          return context
            ? { merchantId: context.merchantId, artUrl: demoMerchants.find((merchant) => merchant.id === context.merchantId)?.artUrl ?? null }
            : undefined;
        }),
      client.getShowcaseAccessState(),
    ])
      .then(([allowed, accessState]) => {
        if (!active) return;
        setState(allowed ? { status: 'allowed', ...allowed } : { status: 'denied' });
        setAccess({ status: 'ready', request: accessState.request, approver: accessState.approver });
      })
      .catch(() => {
        if (!active) return;
        setState({ status: 'error' });
        setAccess({ status: 'error' });
      });
    return () => { active = false; };
  }, [apiUrl, client, retry]);

  // 수락은 다른 기기(관리자 화면)에서 일어날 수 있어 대기 중인 동안 주기적으로 다시 읽고, 수락을 감지하면 위 효과를 다시 돌려 권한을 반영한다.
  // ponytail: 매 호출마다 setAccess로 effect가 재실행돼 5초 간격 setInterval을 다시 거는 단순한 구현. 대기 요청이 소수인 시연 규모에서는 충분하다.
  useEffect(() => {
    if (!client || state.status !== 'denied' || access.status !== 'ready' || access.request?.status !== 'PENDING') return;
    const interval = setInterval(() => {
      void client.getShowcaseAccessState()
        .then((next) => {
          setAccess({ status: 'ready', request: next.request, approver: next.approver });
          if (next.request?.status === 'APPROVED') setRetry((value) => value + 1);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [client, state.status, access]);

  async function startRequest() {
    if (!client || requesting) return;
    setRequesting(true);
    setRequestError(undefined);
    try {
      const created = await client.requestShowcaseAccess();
      setAccess((current) => ({ status: 'ready', request: created, approver: current.status === 'ready' ? current.approver : false }));
    } catch (error) {
      setRequestError(
        error instanceof CommerceApiError ? requestAccessFailureMessage(error.status, error.code) : requestAccessFailureMessage(undefined, ''),
      );
    } finally {
      setRequesting(false);
    }
  }

  function openMail(code: string) {
    setMailFallback(false);
    Linking.openURL(accessMailtoUrl(code)).catch(() => setMailFallback(true));
  }

  const status = apiUrl ? state.status : 'error';
  const accessUi = access.status === 'ready' ? accessUiState(access.request) : undefined;
  const showAdminEntry = access.status === 'ready' && access.approver;

  if (tour) return <FoundationScreen initialRole="merchant" showcaseTour onExit={() => setTour(false)} />;

  // The admin page replaces this page the same way: it takes over the navigator, so back returns here through onBack.
  if (adminOpen && apiUrl) {
    return <ShowcaseAccessAdminScreen
      apiUrl={apiUrl}
      credential={credential}
      onSessionInvalid={onSessionInvalid}
      onBack={() => setAdminOpen(false)}
    />;
  }

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
        {showAdminEntry ? <Pressable accessibilityRole="button" onPress={() => setAdminOpen(true)} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>권한 요청 관리</Text>
        </Pressable> : null}
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
    {showAdminEntry ? <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
      <Pressable accessibilityRole="button" onPress={() => setAdminOpen(true)} style={{ minHeight: 48, justifyContent: 'center' }}>
        <Text style={{ color: colors.primary, fontWeight: '700' }}>권한 요청 관리</Text>
      </Pressable>
    </View> : null}
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
    {status === 'denied' && accessUi ? <View accessibilityLiveRegion="polite" style={{ gap: 12 }}>
      {accessUi.kind === 'none' ? <Pressable accessibilityRole="button" disabled={requesting} onPress={() => void startRequest()} style={{ minHeight: 48, justifyContent: 'center' }}>
        <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>현재 계정으로 문의하기</Text>
      </Pressable> : null}
      {accessUi.kind === 'pending' ? <>
        <Text selectable style={{ color: colors.label, fontSize: 16 }}>요청 번호 {accessUi.code} · 검토 대기 중</Text>
        <Text style={{ color: colors.secondaryLabel, fontSize: 14 }}>수락되면 점주 체험이 열립니다.</Text>
        <Pressable accessibilityRole="button" onPress={() => openMail(accessUi.code)} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>메일로 알리기</Text>
        </Pressable>
        {mailFallback ? <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>메일 앱을 열지 못했습니다. 다음 주소로 직접 보내 주세요: {ACCESS_CONTACT_ADDRESSES.join(', ')}</Text> : null}
      </> : null}
      {accessUi.kind === 'approved' ? <Text selectable style={{ color: colors.label, fontSize: 16 }}>수락되었습니다.</Text> : null}
      {accessUi.kind === 'rejected' ? <>
        <Text selectable style={{ color: colors.label, fontSize: 16 }}>요청이 거절되었습니다.</Text>
        <Pressable accessibilityRole="button" disabled={requesting} onPress={() => void startRequest()} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>다시 문의하기</Text>
        </Pressable>
      </> : null}
      {requestError ? <Text accessibilityLiveRegion="polite" selectable style={{ color: colors.error, fontSize: 14 }}>{requestError}</Text> : null}
    </View> : null}
    {status === 'error' ? <Pressable accessibilityRole="button" onPress={() => { setState({ status: 'loading' }); setRetry((value) => value + 1); }} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>다시 시도</Text>
    </Pressable> : null}
    <Pressable accessibilityRole="button" onPress={onBrowse} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>고객으로 둘러보기</Text>
    </Pressable>
  </ScrollView>;
}
