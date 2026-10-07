import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Text, TextInput, useColorScheme, View } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';
import { createSocialApiClient, createSocialRequestId, isHHmm, socialErrorMessage, type MailDetail } from '@/social/social-api';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { BounceButton } from '@/ui/bounce-button';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

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
  const [selectedTime, setSelectedTime] = useState('');
  const [notice, setNotice] = useState<string>();

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
    if (decision === 'ACCEPT' && mail.mealInvitation.schedule.kind === 'RANGE' && (!isHHmm(selectedTime)
      || selectedTime < mail.mealInvitation.schedule.startTime || selectedTime > mail.mealInvitation.schedule.endTime)) {
      setNotice('제안된 범위 안의 시간을 HH:mm으로 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.respondToMealInvitation({
        invitationId: mail.mealInvitation.invitationId,
        requestId: createSocialRequestId('meal-response'),
        decision,
        selectedTime: decision === 'ACCEPT' && mail.mealInvitation.schedule.kind === 'RANGE' ? selectedTime : undefined,
      });
      setMail(result.mail);
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
              <Text style={{ color: palette.label }}>{mail.mealInvitation.merchant.name}</Text>
              <Text style={{ color: palette.secondaryLabel }}>{mail.mealInvitation.merchant.address}</Text>
              <BounceButton label="가게 정보 보기" variant="secondary" onPress={() => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId: mail.mealInvitation!.merchant.id } })} />
              <Text style={{ color: palette.label }}>{mealScheduleCopy(mail.mealInvitation.date, mail.mealInvitation.schedule)}</Text>
              {mail.mealInvitation.selectedTime ? <Text style={{ color: palette.success, fontWeight: '800' }}>확정 시간: {mail.mealInvitation.selectedTime}</Text> : null}
              <Text style={{ color: palette.label }}>상태: {invitationStatusCopy(mail.mealInvitation.status)}</Text>
              {mail.mealInvitation.status === 'PENDING' && mail.direction === 'INBOX' ? (
                <View style={{ gap: 10 }}>
                  {mail.mealInvitation.schedule.kind === 'RANGE' ? (
                    <TextInput
                      value={selectedTime}
                      onChangeText={setSelectedTime}
                      placeholder="예: 12:40"
                      accessibilityLabel="수락할 시간"
                      autoCapitalize="none"
                      placeholderTextColor={palette.secondaryLabel}
                      style={{ minHeight: 48, borderWidth: 1, borderColor: palette.separator, borderRadius: 8, paddingHorizontal: 12, color: palette.label, backgroundColor: palette.surface }}
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
  return schedule.kind === 'CONFIRMED' ? `${date} ${schedule.time}` : `${date} ${schedule.startTime}-${schedule.endTime}`;
}

function invitationStatusCopy(status: NonNullable<MailDetail['mealInvitation']>['status']): string {
  switch (status) {
    case 'PENDING': return '답장 대기';
    case 'ACCEPTED': return '수락됨';
    case 'DECLINED': return '거절됨';
    case 'EXPIRED': return '만료됨';
  }
}
