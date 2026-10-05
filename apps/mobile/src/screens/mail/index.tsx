import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, Text, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { createSocialApiClient, socialErrorMessage, type MailListItem } from '@/social/social-api';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

type Load = { status: 'loading' | 'ready' | 'error'; mail: readonly MailListItem[]; error?: unknown };

export function MailboxScreen({ apiUrl, credential, onSessionInvalid, header = <BackHeader title="우편" /> }: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
  header?: ReactNode;
}) {
  const router = useRouter();
  const clearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createSocialApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [load, setLoad] = useState<Load>({ status: 'loading', mail: [] });
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (quiet: boolean) => {
    try {
      const next = await api.listMail();
      setLoad({ status: 'ready', mail: next.mail });
    } catch (error) {
      setLoad((current) => quiet && current.status === 'ready' ? { ...current, error } : { status: 'error', mail: current.mail, error });
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void refresh(load.status === 'ready'); }, [load.status, refresh]));

  const pull = async () => {
    setRefreshing(true);
    try {
      await refresh(true);
    } finally {
      setRefreshing(false);
    }
  };

  const body = load.status === 'loading' ? (
    <StateScene kind="loading" title="우편을 불러오는 중" />
  ) : load.status === 'error' ? (
    <StateScene kind="error" title="우편을 불러오지 못했어요" body={socialErrorMessage(load.error)} action={{ label: '다시 불러오기', onPress: () => { void refresh(false); } }} />
  ) : load.mail.length === 0 ? (
    <StateScene kind="empty" title="아직 우편이 없어요" body="친구의 쪽지와 식사 초대 답장이 여기에 도착해요." />
  ) : (
    <View style={{ gap: 10 }}>
      {load.mail.map((mail) => <MailRow key={mail.id} mail={mail} onPress={() => router.push({ pathname: '/mail/[mailId]', params: { mailId: mail.id } })} />)}
    </View>
  );

  return (
    <SkyBackdrop>
      <SkyScrollView
        header={header}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: clearance, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void pull(); }} progressViewOffset={insets.top} />}
      >
        {body}
      </SkyScrollView>
    </SkyBackdrop>
  );
}

function MailRow({ mail, onPress }: { mail: MailListItem; onPress: () => void }) {
  const palette = colorsForScheme(useColorScheme());
  return (
    <FloatingCard onPress={onPress} accessibilityLabel={`${mail.title}, ${mail.readAt ? '읽음' : '읽지 않음'}`}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
          <Text accessibilityRole="header" style={{ color: palette.label, fontWeight: '800', fontSize: 18, flex: 1 }}>{mail.title}</Text>
          {!mail.readAt && mail.direction === 'INBOX' ? <Text style={{ fontWeight: '800', color: palette.success }}>새 우편</Text> : null}
        </View>
        <Text numberOfLines={2} style={{ color: palette.label }}>{mail.preview}</Text>
        <Text style={{ color: palette.secondaryLabel, fontSize: 12 }}>{mail.direction === 'INBOX' ? `보낸 사람 ${mail.fromNickname ?? '친구'}` : `받는 사람 ${mail.toNickname ?? '친구'}`}</Text>
      </View>
    </FloatingCard>
  );
}

export function MailEntryButton({ unreadCount }: { unreadCount: number }) {
  const palette = colorsForScheme(useColorScheme());
  return (
    <Link href="/mail" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`우편함${unreadCount > 0 ? `, 읽지 않은 우편 ${unreadCount}개` : ''}`} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: palette.label, fontWeight: '800' }}>{unreadCount > 0 ? `우편 ${unreadCount}` : '우편'}</Text>
      </Pressable>
    </Link>
  );
}
