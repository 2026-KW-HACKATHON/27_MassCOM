import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';
import { CommerceApiError, createCommerceApiClient, type ShowcaseAccessRequest, type ShowcaseAccessState } from '@/commerce/commerce-api';
import { createMerchantApiClient } from '@/merchant/merchant-api';
import { findShowcaseStaffMerchant } from '@/merchant/showcase-staff';
import { useAppForeground } from '@/merchant-art/use-merchant-art';
import { MerchantArtScreen } from '@/screens/merchant-art';
import { MerchantHomeScreen } from '@/screens/merchant-home';
import { NotificationCenter } from '@/notifications/center';
import { queueNotificationTarget } from '@/notifications/pending-target';
import { FoundationScreen } from '@/screens/foundation';
import { ShowcaseAccessAdminScreen } from '@/screens/showcase-access-admin';
import { ACCESS_CONTACT_ADDRESSES, accessMailtoUrl, accessUiState, requestAccessFailureMessage } from '@/showcase/access-copy';
import { colorsForScheme } from '@/theme/palette';
import { createAccessPoller, decidePermissionRecheck, shouldHandleHardwareBack } from './access-poll';

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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'denied' } | { status: 'error' } |
    { status: 'allowed'; merchantId: string; merchantName: string; role: 'OWNER' | 'STAFF'; artUrl: string | null }
  >({ status: 'loading' });
  // 권한 요청 상태(#294). 점주 체험 가능 여부와 별개로 읽는다: 거부 화면의 문의 흐름과, 두 상태 모두에서 보이는 승인자 메뉴가 이 값을 쓴다.
  const [access, setAccess] = useState<
    { status: 'loading' } | { status: 'error' } |
    { status: 'ready'; request: ShowcaseAccessRequest | null; approver: boolean }
  >({ status: 'loading' });
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const [mailFallback, setMailFallback] = useState(false);
  // 리뷰 #1: 승인(APPROVED)됐지만 점주 권한이 아직 따라오지 못한 요청의 code. 그 요청에는 자동 재확인을 한 번만 쓴다.
  const recheckedCodeRef = useRef<string | undefined>(undefined);
  const [permissionStuck, setPermissionStuck] = useState(false);
  // The art screen reports the picture customers see, so the owner page's card follows an apply or a reset without another fetch.
  const syncArtUrl = useCallback((artUrl: string | null) => {
    setState((current) => (current.status === 'allowed' && current.artUrl !== artUrl ? { ...current, artUrl } : current));
  }, []);
  const client = useMemo(
    () => apiUrl ? createCommerceApiClient({ apiUrl, credential, onSessionInvalid }) : undefined,
    [apiUrl, credential, onSessionInvalid],
  );

  useEffect(() => {
    if (!notificationsOpen && !shouldHandleHardwareBack({ tour, adminOpen, screenStatus: state.status })) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // 관리자 화면이 이 화면을 대체하고 있는 동안은 점주 화면으로 돌아가는 것이 먼저다(리뷰 #6):
      // 그렇지 않으면 상위 BackHandler가 걸려 고객 탐색으로 건너뛰어 버린다. 직원 권한 없는 승인자가 관리자 화면만 연
      // 경우에도(리뷰 #3) adminOpen이 true면 여기서 받는다.
      if (notificationsOpen) setNotificationsOpen(false);
      else if (adminOpen) setAdminOpen(false);
      else if (artOpen) setArtOpen(false);
      else onBrowse();
      return true;
    });
    return () => subscription.remove();
  }, [adminOpen, artOpen, notificationsOpen, onBrowse, state.status, tour]);

  // 리뷰 #1: 승인된 요청에 자동 재확인을 한 번만 걸고, 그래도 거부면 멈춰서 수동 "다시 확인"으로 넘긴다.
  const evaluateRecheck = useCallback((request: ShowcaseAccessRequest | null | undefined, screenStatus: 'allowed' | 'denied') => {
    const decision = decidePermissionRecheck(request, screenStatus, recheckedCodeRef.current);
    if (decision.action === 'recheck') {
      recheckedCodeRef.current = decision.code;
      setPermissionStuck(false);
      setRetry((value) => value + 1);
    } else if (decision.action === 'stuck') {
      setPermissionStuck(true);
    } else {
      setPermissionStuck(false);
    }
  }, []);

  function manualRecheck() {
    recheckedCodeRef.current = undefined;
    setPermissionStuck(false);
    setRetry((value) => value + 1);
  }

  useEffect(() => {
    if (!apiUrl || !client) return;
    let mounted = true;
    void Promise.all([
      createMerchantApiClient(apiUrl).listMerchants(),
      client.getShowcaseAccessState(),
    ])
      .then(async ([merchants, accessState]) => {
        const demoMerchants = merchants.filter((merchant) => merchant.demo);
        // 체험 로그인(#309)의 개인 체험 가게는 is_public은 true지만(D-064(e)) 서버가 공개 목록·추천에서
        // 걸러 내므로 여기서도 보이지 않는다 — 자기 가게 id를 먼저 넣어 찾는다.
        const merchantIds = accessState.trialMerchantId
          ? [accessState.trialMerchantId, ...demoMerchants.map((merchant) => merchant.id)]
          : demoMerchants.map((merchant) => merchant.id);
        const context = await findShowcaseStaffMerchant(merchantIds, client.getMerchantContext);
        // 체험 가게는 /merchants 목록에 없어 artUrl을 거기서 가져올 수 없다 — art 화면이 첫 조회로 채운다.
        const allowed = context
          ? { merchantId: context.merchantId, role: context.role, merchantName: demoMerchants.find((merchant) => merchant.id === context.merchantId)?.name ?? '나의 체험 가게', artUrl: demoMerchants.find((merchant) => merchant.id === context.merchantId)?.artUrl ?? null }
          : undefined;
        return { allowed, accessState };
      })
      .then(({ allowed, accessState }) => {
        if (!mounted) return;
        const nextStatus = allowed ? 'allowed' : 'denied';
        setState(allowed ? { status: 'allowed', ...allowed } : { status: 'denied' });
        setAccess({ status: 'ready', request: accessState.request, approver: accessState.approver });
        // 이 조회 자체가 이미 APPROVED를 돌려줬는데 점주 권한 쪽이 아직 따라오지 못했다면(리뷰 #1) 다시 확인한다.
        evaluateRecheck(accessState.request, nextStatus);
      })
      .catch(() => {
        if (!mounted) return;
        setState({ status: 'error' });
        setAccess({ status: 'error' });
      });
    return () => { mounted = false; };
  }, [apiUrl, client, retry, evaluateRecheck]);

  // 수락은 다른 기기(관리자 화면)에서 일어날 수 있어 대기 중인 동안 주기적으로 다시 읽고, 수락을 감지하면 위 효과를 다시 돌려 권한을 반영한다.
  // 이 화면이 투어·그림·관리자 화면으로 가려지거나(화면 포커스) 앱이 배경에 있는 동안은(AppState) 묻지 않는다(리뷰 #3).
  const focused = !tour && !artOpen && !adminOpen;
  const foreground = useAppForeground();
  const active = focused && foreground;
  const pollPending = Boolean(client) && state.status === 'denied' && access.status === 'ready' && access.request?.status === 'PENDING';

  const applyAccessAnswer = useCallback((next: ShowcaseAccessState) => {
    setAccess({ status: 'ready', request: next.request, approver: next.approver });
    evaluateRecheck(next.request, 'denied');
  }, [evaluateRecheck]);

  // 화면으로(또는 앱 전면으로) 돌아왔을 때는 간격을 기다리지 않고 같은 poller로 바로 한 번 더 묻는다(리뷰 #2): 별도의 GET을
  // 띄우면 그 응답이 poller의 generation 검사를 타지 않아, 가려져 있던 동안 더 새로운 PENDING이 들어와도 늦게 돌아온 낡은
  // 응답이 그걸 덮어쓸 수 있다. pokeNow()는 같은 generation·in-flight 규칙을 타므로 stop() 뒤에 도착하면 버려진다.
  const wasActive = useRef(active);
  useEffect(() => {
    const resuming = active && !wasActive.current;
    wasActive.current = active;
    if (!active || !pollPending || !client) return;
    const poller = createAccessPoller({
      poll: () => client.getShowcaseAccessState(),
      onResult: applyAccessAnswer,
      shouldContinue: (next) => next.request?.status === 'PENDING',
    });
    if (resuming) poller.pokeNow();
    else poller.start();
    return () => poller.stop();
  }, [active, pollPending, client, applyAccessAnswer]);

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

  if (notificationsOpen && apiUrl) return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <Pressable accessibilityRole="button" onPress={() => setNotificationsOpen(false)} style={{ padding: 20 }}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>← 점주 화면</Text>
    </Pressable>
    <NotificationCenter apiUrl={apiUrl} credential={credential}
      onMerchantTarget={() => setNotificationsOpen(false)}
      onCustomerTarget={target => { queueNotificationTarget(accountId, target); onBrowse(); }} />
  </View>;

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
    return <MerchantHomeScreen
      apiUrl={apiUrl}
      accountId={accountId}
      merchantId={state.merchantId}
      merchantName={state.merchantName}
      role={state.role}
      artUrl={state.artUrl}
      credential={credential}
      onSessionInvalid={onSessionInvalid}
      onBrowse={onBrowse}
      onTour={() => setTour(true)}
      onArt={() => setArtOpen(true)}
      onAdmin={showAdminEntry ? () => setAdminOpen(true) : undefined}
      onNotifications={() => setNotificationsOpen(true)}
      onLogout={onLogout}
    />;
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
      {accessUi.kind === 'approved' ? <>
        <Text selectable style={{ color: colors.label, fontSize: 16 }}>수락되었습니다.</Text>
        {permissionStuck ? <>
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>수락됐지만 아직 점주 화면을 열 수 없어요. 잠시 뒤 다시 확인해 주세요.</Text>
          <Pressable accessibilityRole="button" onPress={manualRecheck} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>다시 확인</Text>
          </Pressable>
        </> : null}
      </> : null}
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
