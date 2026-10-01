import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';
import { CommerceApiError, createCommerceApiClient, type PendingShowcaseAccessRequest } from '@/commerce/commerce-api';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { ADMIN_CONFIRM_TEXT, ADMIN_CONFIRM_TITLE, decideFailureMessage, listPendingFailureMessage, pendingRowText, staleAfterDecideFailure } from './copy';

type Props = {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => void | Promise<void>;
  /** 점주 화면이 자기 자신을 대체하는 방식과 같다(화면이 내비게이터 전체를 갈아끼운다). */
  onBack: () => void;
};

/**
 * 점주 체험 권한 요청 관리자 화면(#294). platform_admins 승인자만 서버가 목록·수락·거절을 허용한다(403은 서버가 가린다).
 * 문구·서식·실패 코드 매핑은 copy.ts(순수 로직, 시험 있음)가 맡고 이 화면은 그 상태를 그린다.
 */
export function ShowcaseAccessAdminScreen({ apiUrl, credential, onSessionInvalid, onBack }: Props) {
  const colors = colorsForScheme(useColorScheme());
  const client = useMemo(
    () => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; requests: readonly PendingShowcaseAccessRequest[] }
  >({ status: 'loading' });
  const [busyId, setBusyId] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  // 재시도·수락/거절 뒤 새로 불러오기는 이벤트 처리 함수에서 "loading"으로 바꾼 뒤 이 함수로 가져온다.
  // 마운트 때는 effect 안에서 바로 호출한다: 초기 state가 이미 "loading"이라 effect 본문에서 setState를 또 부르지 않는다.
  const fetchRequests = useCallback(() => {
    client.listPendingShowcaseAccessRequests()
      .then((requests) => setState({ status: 'ready', requests }))
      .catch((error) => setState({
        status: 'error',
        message: error instanceof CommerceApiError ? listPendingFailureMessage(error.status, error.code) : listPendingFailureMessage(undefined, ''),
      }));
  }, [client]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  function load() {
    setState({ status: 'loading' });
    fetchRequests();
  }

  async function decide(request: PendingShowcaseAccessRequest, decision: 'approve' | 'reject') {
    if (busyId) return;
    setBusyId(request.id);
    setActionError(undefined);
    try {
      await client.decideShowcaseAccessRequest({ requestId: request.id, decision });
      load();
    } catch (error) {
      const httpStatus = error instanceof CommerceApiError ? error.status : undefined;
      const code = error instanceof CommerceApiError ? error.code : '';
      setActionError(decideFailureMessage(httpStatus, code));
      if (staleAfterDecideFailure(code)) load();
    } finally {
      setBusyId(undefined);
    }
  }

  function confirmApprove(request: PendingShowcaseAccessRequest) {
    Alert.alert(ADMIN_CONFIRM_TITLE, ADMIN_CONFIRM_TEXT, [
      { text: '취소', style: 'cancel' },
      { text: '수락', onPress: () => void decide(request, 'approve') },
    ]);
  }

  return <ScrollView
    contentInsetAdjustmentBehavior="automatic"
    style={{ flex: 1, backgroundColor: colors.background }}
    contentContainerStyle={{ flexGrow: 1, paddingBottom: 28 }}
  >
    <BackHeader title="권한 요청" onBack={onBack} />
    <View style={{ paddingHorizontal: 20, gap: 16 }}>
      {state.status === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}
      {state.status === 'error' ? <>
        <Text accessibilityLiveRegion="polite" style={{ color: colors.label, fontSize: 16 }}>{state.message}</Text>
        <Pressable accessibilityRole="button" onPress={load} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>다시 시도</Text>
        </Pressable>
      </> : null}
      {state.status === 'ready' && state.requests.length === 0
        ? <Text style={{ color: colors.secondaryLabel, fontSize: 16 }}>대기 중인 요청이 없습니다.</Text>
        : null}
      {state.status === 'ready' ? state.requests.map((request) => (
        <View key={request.id} style={{ gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.separator }}>
          <Text selectable style={{ color: colors.label, fontSize: 16 }}>{pendingRowText(request)}</Text>
          <View style={{ flexDirection: 'row', gap: 20 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${pendingRowText(request)} 수락`}
              disabled={busyId === request.id}
              onPress={() => confirmApprove(request)}
              style={{ minHeight: 48, justifyContent: 'center' }}
            >
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>수락</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${pendingRowText(request)} 거절`}
              disabled={busyId === request.id}
              onPress={() => void decide(request, 'reject')}
              style={{ minHeight: 48, justifyContent: 'center' }}
            >
              <Text style={{ color: colors.error, fontSize: 16, fontWeight: '700' }}>거절</Text>
            </Pressable>
          </View>
        </View>
      )) : null}
      {actionError ? <Text accessibilityLiveRegion="polite" selectable style={{ color: colors.error, fontSize: 14 }}>{actionError}</Text> : null}
    </View>
  </ScrollView>;
}
