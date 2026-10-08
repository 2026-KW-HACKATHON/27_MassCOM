import { useLocalSearchParams, useRouter } from 'expo-router';
import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, useColorScheme, View } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
import { createDiscoveryApiClient, type MerchantDetail } from '@/merchant/discovery-api';
import { businessStateAt } from '../../../../api/src/real-world-hours';
import { createSocialApiClient, createSocialRequestId, isHHmm, socialErrorMessage, type MealSchedule } from '@/social/social-api';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { BounceButton } from '@/ui/bounce-button';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export function MessageComposeScreen({ apiUrl, credential, onSessionInvalid, friendshipId }: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
  friendshipId: string;
}) {
  const router = useRouter();
  const palette = colorsForScheme(useColorScheme());
  const api = useMemo(() => createSocialApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [body, setBody] = useState('');
  const messageRequestId = useRef<string | undefined>(undefined);
  useEffect(() => { messageRequestId.current = undefined; }, [friendshipId, apiUrl, credential]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  async function send() {
    if (busy) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await api.sendMessage({ friendshipId, requestId: messageRequestId.current ??= createSocialRequestId('message'), body });
      messageRequestId.current = undefined;
      router.replace('/mail');
    } catch (caught) {
      setNotice(socialErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SkyBackdrop>
      <SkyScrollView header={<BackHeader title="쪽지 쓰기" />} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 40, gap: 12 }}>
        <FloatingCard>
          <View style={{ gap: 10 }}>
            <Text accessibilityRole="header" style={{ color: palette.label, fontWeight: '900', fontSize: 20 }}>친구에게 쪽지 보내기</Text>
            <TextInput
              value={body}
              onChangeText={value => { if (value !== body) { setBody(value); messageRequestId.current = undefined; } }}
              multiline
              maxLength={500}
              placeholder="500자까지 쓸 수 있어요."
              accessibilityLabel="쪽지 내용"
              placeholderTextColor={palette.secondaryLabel}
              style={{ ...fieldStyle, minHeight: 160, color: palette.label, borderColor: palette.separator, backgroundColor: palette.surface, padding: 12, textAlignVertical: 'top' }}
            />
            <BounceButton label={busy ? '보내는 중…' : '보내기'} disabled={busy || body.trim().length === 0} onPress={() => { void send(); }} />
          </View>
        </FloatingCard>
        {notice ? <Text accessibilityLiveRegion="polite" style={{ color: palette.error, fontWeight: '700' }}>{notice}</Text> : null}
      </SkyScrollView>
    </SkyBackdrop>
  );
}

export function MealInviteScreen({ apiUrl, credential, onSessionInvalid, friendshipId }: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
  friendshipId: string;
}) {
  const router = useRouter();
  const palette = colorsForScheme(useColorScheme());
  const { merchantId } = useLocalSearchParams<{ merchantId?: string }>();
  const api = useMemo(() => createSocialApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const { merchants, loading: merchantsLoading, error: merchantsError } = useMerchantCatalog(apiUrl);
  const selectedMerchant = useMemo(
    () => merchants.find((merchant) => merchant.id === merchantId),
    [merchantId, merchants],
  );
  const discovery = useMemo(() => createDiscoveryApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [detailState, setDetailState] = useState<{ merchantId: string; detail?: MerchantDetail; error?: true }>();
  const detail = detailState && detailState.merchantId === merchantId ? detailState.detail : undefined;
  const detailError = detailState && detailState.merchantId === merchantId && detailState.error === true;
  useEffect(() => {
    if (!merchantId) return;
    const controller = new AbortController();
    void discovery.merchant(merchantId, controller.signal).then((value) => {
      if (!controller.signal.aborted) setDetailState({ merchantId, detail: value });
    }).catch(() => { if (!controller.signal.aborted) setDetailState({ merchantId, error: true }); });
    return () => controller.abort();
  }, [discovery, merchantId]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [kind, setKind] = useState<'CONFIRMED' | 'RANGE'>('CONFIRMED');
  const mealRequestId = useRef<string | undefined>(undefined);
  useEffect(() => { mealRequestId.current = undefined; }, [friendshipId, apiUrl, credential, merchantId]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const plannedTime = /^\d{4}-\d{2}-\d{2}$/.test(date) && isHHmm(kind === 'CONFIRMED' ? time : startTime)
    ? new Date(`${date}T${kind === 'CONFIRMED' ? time : startTime}:00+09:00`) : undefined;
  const plannedBusiness = detail && plannedTime && Number.isFinite(plannedTime.getTime())
    ? businessStateAt(detail.schedule, plannedTime, detail.todayOverride) : undefined;
  const businessLabel = { OPEN: '영업 중', CLOSED: '영업 종료', BREAK: '휴게 시간', UNKNOWN: '영업 정보 확인 필요' } as const;

  async function send() {
    if (!merchantId || !selectedMerchant || detail?.id !== merchantId) { setNotice('최신 가게 정보를 확인한 뒤 초대해 주세요.'); return; }
    const schedule: MealSchedule = kind === 'CONFIRMED' ? { kind, time } : { kind, startTime, endTime };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (kind === 'CONFIRMED' ? !isHHmm(time) : (!isHHmm(startTime) || !isHHmm(endTime)))) {
      setNotice('날짜와 시간을 형식에 맞게 입력해 주세요.');
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      await api.createMealInvitation({ friendshipId, requestId: mealRequestId.current ??= createSocialRequestId('meal-invite'), merchantId, date, schedule });
      mealRequestId.current = undefined;
      router.replace('/mail');
    } catch (caught) {
      setNotice(socialErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SkyBackdrop>
      <SkyScrollView header={<BackHeader title="같이 밥 먹기" />} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 40, gap: 12 }}>
        <FloatingCard>
          <View style={{ gap: 10 }}>
            <Text accessibilityRole="header" style={{ color: palette.label, fontWeight: '900', fontSize: 20 }}>식사 초대 만들기</Text>
            <BounceButton
              label={merchantId ? '가게 다시 선택' : '가게 선택'}
              variant="secondary"
              onPress={() => router.push({ pathname: '/meal-merchant', params: { friendshipId } })}
            />
            {merchantId ? (
              selectedMerchant ? (
                <View>
                  <Text style={{ color: palette.label, fontWeight: '900', fontSize: 16 }}>{publicDataDemoStoreName(selectedMerchant.id, selectedMerchant.name)}</Text>
                  <Text selectable style={{ color: palette.secondaryLabel, marginTop: 3 }}>{selectedMerchant.roadAddress}</Text>
                  <Text style={{ color: palette.secondaryLabel, marginTop: 3 }}>현재 {detail ? businessLabel[detail.business.state] : detailError ? '영업 상태 확인 실패' : '영업 상태 확인 중…'}</Text>
                  <BounceButton label="가게 정보 보기" variant="secondary" onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId } })} />
                </View>
              ) : (
                <Text style={{ color: merchantsError ? palette.error : palette.secondaryLabel, fontWeight: '700' }}>
                  {merchantsError ? '선택한 가게 정보를 불러오지 못했습니다.' : merchantsLoading ? '선택한 가게 정보를 불러오는 중…' : '선택한 가게를 찾을 수 없습니다.'}
                </Text>
              )
            ) : null}
            {plannedBusiness ? <Text style={{ color: palette.secondaryLabel }}>제안한 시간 기준 {businessLabel[plannedBusiness.state]} · 시간표와 임시 변경 정보 기준</Text> : null}
            <Text style={{ color: palette.secondaryLabel }}>선택한 날짜와 시간은 친구에게 보내는 약속 제안입니다. 친구 간 약속 · 매장 예약 아님. 방문 전 가게 위치와 최신 영업 상태를 확인해 주세요.</Text>
            <TextInput value={date} onChangeText={value => { if (value !== date) { setDate(value); mealRequestId.current = undefined; } }} placeholder="YYYY-MM-DD" accessibilityLabel="초대 날짜" placeholderTextColor={palette.secondaryLabel} style={{ ...fieldStyle, color: palette.label, borderColor: palette.separator, backgroundColor: palette.surface }} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><BounceButton label="확정 시간" variant={kind === 'CONFIRMED' ? 'primary' : 'secondary'} onPress={() => { if (kind !== 'CONFIRMED') { setKind('CONFIRMED'); mealRequestId.current = undefined; } }} /></View>
              <View style={{ flex: 1 }}><BounceButton label="시간 범위" variant={kind === 'RANGE' ? 'primary' : 'secondary'} onPress={() => { if (kind !== 'RANGE') { setKind('RANGE'); mealRequestId.current = undefined; } }} /></View>
            </View>
            {kind === 'CONFIRMED' ? (
              <TextInput value={time} onChangeText={value => { if (value !== time) { setTime(value); mealRequestId.current = undefined; } }} placeholder="HH:mm" accessibilityLabel="확정 시간" placeholderTextColor={palette.secondaryLabel} style={{ ...fieldStyle, color: palette.label, borderColor: palette.separator, backgroundColor: palette.surface }} />
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput value={startTime} onChangeText={value => { if (value !== startTime) { setStartTime(value); mealRequestId.current = undefined; } }} placeholder="시작 HH:mm" accessibilityLabel="시작 시간" placeholderTextColor={palette.secondaryLabel} style={[fieldStyle, { flex: 1, color: palette.label, borderColor: palette.separator, backgroundColor: palette.surface }]} />
                <TextInput value={endTime} onChangeText={value => { if (value !== endTime) { setEndTime(value); mealRequestId.current = undefined; } }} placeholder="끝 HH:mm" accessibilityLabel="끝 시간" placeholderTextColor={palette.secondaryLabel} style={[fieldStyle, { flex: 1, color: palette.label, borderColor: palette.separator, backgroundColor: palette.surface }]} />
              </View>
            )}
            <BounceButton label={busy ? '보내는 중…' : '초대 보내기'} disabled={busy || !selectedMerchant || detail?.id !== merchantId} onPress={() => { void send(); }} />
          </View>
        </FloatingCard>
        {notice ? <Text accessibilityLiveRegion="polite" style={{ color: palette.error, fontWeight: '700' }}>{notice}</Text> : null}
      </SkyScrollView>
    </SkyBackdrop>
  );
}

const fieldStyle = { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12 } as const;
