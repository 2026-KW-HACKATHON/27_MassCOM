import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, useColorScheme, View } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';
import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';
import { createSocialApiClient, createSocialRequestId, socialErrorMessage, type MailDetail } from '@/social/social-api';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { BounceButton } from '@/ui/bounce-button';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';
import { MealTimePicker } from './meal-date-time-picker';
import { mealDateLabel, mealResponseTimeError, mealScheduleError } from './meal-picker-state';

export function MailDetailScreen({ apiUrl, credential, onSessionInvalid, mailId }: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
  mailId: string;
}) {
  const api = useMemo(() => createSocialApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const router = useRouter();
  const palette = colorsForScheme(useColorScheme());
  const [mail, setMail] = useState<MailDetail>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [timeSelection, setTimeSelection] = useState<{ mailId: string; value: string }>();
  const selectedTime = timeSelection?.mailId === mailId ? timeSelection.value : '';
  const [notice, setNotice] = useState<string>();
  const responseRequest = useRef<{ decision: 'ACCEPT' | 'DECLINE'; requestId: string } | undefined>(undefined);
  useEffect(() => { responseRequest.current = undefined; }, [mailId, apiUrl, credential]);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const next = await api.getMail(mailId);
      setMail(next);
      if (next.direction === 'INBOX' && !next.readAt) {
        api.markMailRead(mailId).then(setMail).catch(() => undefined);
      }
    } catch (caught) {
      setError(caught);
    }
  }, [api, mailId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function respond(decision: 'ACCEPT' | 'DECLINE') {
    if (!mail?.mealInvitation || busy) return;
    setNotice(undefined);
    if (decision === 'ACCEPT') {
      const invitation = mail.mealInvitation;
      const scheduleError = invitation.schedule.kind === 'RANGE'
        ? mealResponseTimeError(invitation.date, selectedTime, invitation.schedule.startTime, invitation.schedule.endTime)
        : mealScheduleError(invitation.date, invitation.schedule);
      if (scheduleError) { setNotice(scheduleError); return; }
    }
    if (responseRequest.current?.decision !== decision) responseRequest.current = { decision, requestId: createSocialRequestId('meal-response') };
    setBusy(true);
    try {
      const result = await api.respondToMealInvitation({
        invitationId: mail.mealInvitation.invitationId,
        requestId: responseRequest.current.requestId,
        decision,
        selectedTime: decision === 'ACCEPT' && mail.mealInvitation.schedule.kind === 'RANGE' ? selectedTime : undefined,
      });
      setMail(result.mail);
      responseRequest.current = undefined;
      setNotice(decision === 'ACCEPT' ? '초대를 수락했어요. 친구에게 우편을 보냈어요.' : '초대를 거절했어요. 친구에게 우편을 보냈어요.');
    } catch (caught) {
      setNotice(socialErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (error && !mail) {
    return (
      <SkyBackdrop>
        <SkyScrollView header={<BackHeader title="우편" />}>
          <StateScene kind="error" title="우편을 불러오지 못했어요" body={socialErrorMessage(error)} action={{ label: '다시 불러오기', onPress: () => { void load(); } }} />
        </SkyScrollView>
      </SkyBackdrop>
    );
  }

  if (!mail) {
    return (
      <SkyBackdrop>
        <SkyScrollView header={<BackHeader title="우편" />}>
          <StateScene kind="loading" title="우편을 펼치는 중" />
        </SkyScrollView>
      </SkyBackdrop>
    );
  }

  return (
    <SkyBackdrop>
      <SkyScrollView header={<BackHeader title="우편" />} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 40, gap: 12 }}>
        <FloatingCard>
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ color: palette.label, fontWeight: '900', fontSize: 22 }}>{mail.title}</Text>
            <Text style={{ color: palette.secondaryLabel }}>{mail.direction === 'INBOX' ? `보낸 사람 ${mail.fromNickname ?? '친구'}` : `받는 사람 ${mail.toNickname ?? '친구'}`}</Text>
            <Text style={{ color: palette.label, fontSize: 16, lineHeight: 24 }}>{mail.body}</Text>
          </View>
        </FloatingCard>
        {mail.mealInvitation ? (
          <FloatingCard>
            <View style={{ gap: 10 }}>
              <Text accessibilityRole="header" style={{ color: palette.label, fontWeight: '800', fontSize: 18 }}>식사 초대</Text>
              <Text style={{ color: palette.label }}>{publicDataDemoStoreName(mail.mealInvitation.merchant.id, mail.mealInvitation.merchant.name)}</Text>
              <Text style={{ color: palette.secondaryLabel }}>{mail.mealInvitation.merchant.address}</Text>
              <BounceButton label="가게 정보 보기" variant="secondary" onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: mail.mealInvitation!.merchant.id } })} />
              <Text style={{ color: palette.label }}>{mealScheduleCopy(mail.mealInvitation.date, mail.mealInvitation.schedule)}</Text>
              {mail.mealInvitation.selectedTime ? <Text style={{ color: palette.success, fontWeight: '800' }}>확정 시간: {mail.mealInvitation.selectedTime}</Text> : null}
              <Text style={{ color: palette.label }}>상태: {invitationStatusCopy(mail.mealInvitation.status)}</Text>
              {mail.mealInvitation.status === 'PENDING' && mail.direction === 'INBOX' ? (
                <View style={{ gap: 10 }}>
                  {mail.mealInvitation.schedule.kind === 'RANGE' ? (
                    <MealTimePicker
                      value={selectedTime}
                      onChange={value => { if (value !== selectedTime) { setTimeSelection({ mailId, value }); responseRequest.current = undefined; } }}
                      label="수락할 시간"
                      minTime={mail.mealInvitation.schedule.startTime}
                      maxTime={mail.mealInvitation.schedule.endTime}
                      disabled={busy}
                    />
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}><BounceButton label={busy ? '보내는 중…' : '수락'} disabled={busy} onPress={() => { void respond('ACCEPT'); }} /></View>
                    <View style={{ flex: 1 }}><BounceButton label="거절" variant="secondary" disabled={busy} onPress={() => { void respond('DECLINE'); }} /></View>
                  </View>
                </View>
              ) : null}
            </View>
          </FloatingCard>
        ) : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={{ color: palette.error, fontWeight: '700' }}>{notice}</Text> : null}
      </SkyScrollView>
    </SkyBackdrop>
  );
}

export function mealScheduleCopy(date: string, schedule: NonNullable<MailDetail['mealInvitation']>['schedule']): string {
  return schedule.kind === 'CONFIRMED' ? `${mealDateLabel(date)} ${schedule.time}` : `${mealDateLabel(date)} ${schedule.startTime}-${schedule.endTime}`;
}

function invitationStatusCopy(status: NonNullable<MailDetail['mealInvitation']>['status']): string {
  switch (status) {
    case 'PENDING': return '답장 대기';
    case 'ACCEPTED': return '수락됨';
    case 'DECLINED': return '거절됨';
    case 'EXPIRED': return '만료됨';
  }
}
