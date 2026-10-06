import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { focusMerchantHeading } from './focus-heading';
import type { AccountCredential } from '@/auth/account-credential';
import { MerchantArtEntryCard } from '@/screens/merchant-art/entry-card';
import { StaffClaimScreen } from '@/screens/merchant-claim/staff';
import type { VisitSelection } from '@/screens/merchant-claim/issued-visit';
import { colorsForScheme } from '@/theme/palette';
import { MerchantStatusScreen } from './status';

const merchantWebUrl = 'https://www.masscom.kr/merchant/';
type Tab = 'visit' | 'status' | 'decorate';

type Props = {
  apiUrl: string;
  accountId: string;
  merchantId: string;
  merchantName: string;
  role: 'OWNER' | 'STAFF';
  artUrl: string | null;
  credential: AccountCredential;
  onSessionInvalid: () => void | Promise<void>;
  onBrowse: () => void;
  onTour: () => void;
  onAdmin?: () => void;
  onNotifications?: () => void;
  onArt: () => void;
  onLogout: () => Promise<void>;
};

export function MerchantHomeScreen(props: Props) {
  const colors = colorsForScheme(useColorScheme());
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('visit');
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const decorateHeading = useRef<Text>(null);
  const [selection, setSelection] = useState<{ visit: VisitSelection; merchantId: string; apiUrl: string; credential: AccountCredential }>();
  const selectedVisit = selection?.merchantId === props.merchantId && selection.apiUrl === props.apiUrl
    && selection.credential === props.credential ? selection.visit : undefined;

  function showVisitReversal(visit: VisitSelection) {
    setSelection({ visit: { claimSlotId: visit.claimSlotId, visitEventId: visit.visitEventId }, merchantId: props.merchantId, apiUrl: props.apiUrl, credential: props.credential });
    setTab('status');
  }

  useEffect(() => {
    if (tab !== 'decorate') return;
    const frame = requestAnimationFrame(() => {
      focusMerchantHeading(decorateHeading.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);

  function choose(action: () => void) {
    setMenuOpen(false);
    action();
  }

  async function shareWeb() {
    try {
      await Share.share({ title: '점주 웹', message: merchantWebUrl });
      setMessage(undefined);
    } catch {
      setMessage('공유 메뉴를 열지 못했어요. 아래 주소를 복사해 주세요.');
    }
  }

  const menuItems = [
    { label: '고객 화면으로', onPress: props.onBrowse },
    { label: '빈 공간 투어', onPress: props.onTour },
    ...(props.onAdmin ? [{ label: '권한 요청 관리', onPress: props.onAdmin }] : []),
    ...(props.onNotifications ? [{ label: '알림함·푸시 설정', onPress: props.onNotifications }] : []),
    { label: '로그아웃', onPress: () => void props.onLogout().catch(() => setMessage('로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.')) },
  ];

  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={{ paddingHorizontal: 20, paddingTop: Math.max(insets.top, 12), paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.separator }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text accessibilityRole="header" selectable numberOfLines={1} style={{ flex: 1, color: colors.label, fontSize: 23, fontWeight: '900' }}>{props.merchantName}</Text>
        <Text style={{ color: colors.onPrimaryContainer, backgroundColor: colors.primaryContainer, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, fontWeight: '800' }}>
          {props.role === 'OWNER' ? '점주' : '직원'}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="점주 메뉴" accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen((open) => !open)} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.label, fontSize: 29, lineHeight: 32 }}>⋯</Text>
        </Pressable>
      </View>
      {menuOpen ? <View style={{ padding: 8, borderRadius: 16, backgroundColor: colors.surface }}>
        {menuItems.map((item) => <Pressable key={item.label} accessibilityRole="button" onPress={() => choose(item.onPress)} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 }}>
          <Text style={{ color: colors.label, fontSize: 16, fontWeight: '700' }}>{item.label}</Text>
        </Pressable>)}
      </View> : null}
      {message ? <Text accessibilityLiveRegion="polite" selectable style={{ color: colors.error, paddingVertical: 8 }}>{message}</Text> : null}
    </View>

    <View style={{ flex: 1, display: tab === 'visit' ? 'flex' : 'none' }} accessibilityElementsHidden={tab !== 'visit'} importantForAccessibility={tab === 'visit' ? 'auto' : 'no-hide-descendants'}>
      <StaffClaimScreen apiUrl={props.apiUrl} accountId={props.accountId} merchantId={props.merchantId} merchantName={props.merchantName} credential={props.credential} onSessionInvalid={props.onSessionInvalid} active={tab === 'visit'} onVisitReversal={showVisitReversal} />
    </View>
    {tab === 'status' ? <MerchantStatusScreen apiUrl={props.apiUrl} merchantId={props.merchantId} credential={props.credential} onSessionInvalid={props.onSessionInvalid} selectedVisit={selectedVisit} /> : null}
    {tab === 'decorate' ? <ScrollView contentContainerStyle={{ gap: 16, padding: 20, paddingBottom: 28 }}>
      <Text ref={decorateHeading} accessible accessibilityRole="header" style={{ color: colors.label, fontSize: 25, fontWeight: '900' }}>가게 꾸미기</Text>
      <MerchantArtEntryCard apiUrl={props.apiUrl} merchantId={props.merchantId} artUrl={props.artUrl} onPress={props.onArt} />
      <View style={{ gap: 10, padding: 18, borderRadius: 20, backgroundColor: colors.surface }}>
        <Text accessibilityRole="header" style={{ color: colors.label, fontSize: 18, fontWeight: '900' }}>수집품 만들기는 점주 웹에서</Text>
        <Text style={{ color: colors.secondaryLabel, lineHeight: 22 }}>점주 웹은 운영 가게 계정에서 열려요</Text>
        <Text selectable style={{ color: colors.primary }}>{merchantWebUrl}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="점주 웹 주소 공유" onPress={() => void shareWeb()} style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: colors.onPrimary, fontWeight: '800' }}>주소 공유하기</Text>
        </Pressable>
      </View>
    </ScrollView> : null}

    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.separator, paddingBottom: Math.max(insets.bottom, 8), backgroundColor: colors.background }}>
      {([
        { id: 'visit', icon: '◎', label: '방문 확인' },
        { id: 'status', icon: '▥', label: '오늘·현황' },
        { id: 'decorate', icon: '✦', label: '가게 꾸미기' },
      ] as const).map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: tab === item.id }} onPress={() => { setMenuOpen(false); setSelection(undefined); setTab(item.id); }} style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <Text accessible={false} style={{ color: tab === item.id ? colors.primary : colors.secondaryLabel, fontSize: 22 }}>{item.icon}</Text>
        <Text style={{ color: tab === item.id ? colors.primary : colors.secondaryLabel, fontSize: 12, fontWeight: '800' }}>{item.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}
