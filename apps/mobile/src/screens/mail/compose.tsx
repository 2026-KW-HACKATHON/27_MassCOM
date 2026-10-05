import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, TextInput, useColorScheme, View } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';
import { useMerchantCatalog } from '@/merchant/use-merchant-catalog';
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  async function send() {
    if (busy) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await api.sendMessage({ friendshipId, requestId: createSocialRequestId('message'), body });
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
              onChangeText={setBody}
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
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [kind, setKind] = useState<'CONFIRMED' | 'RANGE'>('CONFIRMED');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  async function send() {
    if (!merchantId) { setNotice('먼저 가게를 선택해 주세요.'); return; }
    const schedule: MealSchedule = kind === 'CONFIRMED' ? { kind, time } : { kind, startTime, endTime };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (kind === 'CONFIRMED' ? !isHHmm(time) : (!isHHmm(startTime) || !isHHmm(endTime)))) {
      setNotice('날짜와 시간을 형식에 맞게 입력해 주세요.');
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      await api.createMealInvitation({ friendshipId, requestId: createSocialRequestId('meal-invite'), merchantId, date, schedule });
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
                  <Text style={{ color: palette.label, fontWeight: '900', fontSize: 16 }}>{selectedMerchant.name}</Text>
                  <Text selectable style={{ color: palette.secondaryLabel, marginTop: 3 }}>{selectedMerchant.roadAddress}</Text>
                </View>
              ) : (
                <Text style={{ color: merchantsError ? palette.error : palette.secondaryLabel, fontWeight: '700' }}>
                  {merchantsError ? '선택한 가게 정보를 불러오지 못했습니다.' : merchantsLoading ? '선택한 가게 정보를 불러오는 중…' : '선택한 가게를 찾을 수 없습니다.'}
                </Text>
              )
            ) : null}
            <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" accessibilityLabel="초대 날짜" placeholderTextColor={palette.secondaryLabel} style={{ ...fieldStyle, color: palette.label, borderColor: palette.separator, backgroundColor: palette.surface }} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><BounceButton label="확정 시간" variant={kind === 'CONFIRMED' ? 'primary' : 'secondary'} onPress={() => setKind('CONFIRMED')} /></View>
              <View style={{ flex: 1 }}><BounceButton label="시간 범위" variant={kind === 'RANGE' ? 'primary' : 'secondary'} onPress={() => setKind('RANGE')} /></View>
            </View>
            {kind === 'CONFIRMED' ? (
              <TextInput value={time} onChangeText={setTime} placeholder="HH:mm" accessibilityLabel="확정 시간" placeholderTextColor={palette.secondaryLabel} style={{ ...fieldStyle, color: palette.label, borderColor: palette.separator, backgroundColor: palette.surface }} />
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput value={startTime} onChangeText={setStartTime} placeholder="시작 HH:mm" accessibilityLabel="시작 시간" placeholderTextColor={palette.secondaryLabel} style={[fieldStyle, { flex: 1, color: palette.label, borderColor: palette.separator, backgroundColor: palette.surface }]} />
                <TextInput value={endTime} onChangeText={setEndTime} placeholder="끝 HH:mm" accessibilityLabel="끝 시간" placeholderTextColor={palette.secondaryLabel} style={[fieldStyle, { flex: 1, color: palette.label, borderColor: palette.separator, backgroundColor: palette.surface }]} />
              </View>
            )}
            <BounceButton label={busy ? '보내는 중…' : '초대 보내기'} disabled={busy} onPress={() => { void send(); }} />
          </View>
        </FloatingCard>
        {notice ? <Text accessibilityLiveRegion="polite" style={{ color: palette.error, fontWeight: '700' }}>{notice}</Text> : null}
      </SkyScrollView>
    </SkyBackdrop>
  );
}

const fieldStyle = { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12 } as const;
