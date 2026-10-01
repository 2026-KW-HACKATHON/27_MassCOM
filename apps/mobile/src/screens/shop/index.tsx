import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Image, Pressable, RefreshControl, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { colorsForScheme } from '@/theme/palette';
import { AppHeader } from '@/ui/app-header';
import { BounceButton } from '@/ui/bounce-button';
import { FloatingCard } from '@/ui/floating-card';
import { heroMascotSize } from '@/ui/large-text';
import { Mascot } from '@/ui/mascot';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { Stagger } from '@/ui/stagger';
import { StateScene } from '@/ui/state-scene';

import { ShopApiError, createShopApiClient, shopErrorMessage, type MileageGrade, type ShopGradeView, type ShopRerollResult } from '@/shop/shop-api';
import { friendArt, mileageCoinArt, ticketArt } from '@/shop/shop-art';
import {
  buildFriendGrid, earnRulesText, formatMileage, rerollDisclosure, rerollButtonState, resumeOrStartPurchase,
  type FriendGridCell, type PendingPurchase,
} from '@/shop/shop-rules';
import { useShop } from '@/shop/use-shop';

import { DrawReveal } from './draw-reveal';
import { HistorySection } from './history-section';
import { useShopStyles } from './use-shop-styles';

export const SHOP_TITLE = '상점';
export const SHOP_SUBTITLE = '마일리지를 모아 가게 친구를 뽑아요';

type Notice = { tone: 'success' | 'error'; text: string };

export function ShopScreen({ apiUrl, credential, onSessionInvalid }: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
}) {
  const clearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const styles = useShopStyles();
  const { fontScale } = useWindowDimensions();

  const api = useMemo(() => createShopApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const shop = useShop(api);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<PendingPurchase>();
  const [busyGrade, setBusyGrade] = useState<MileageGrade>();
  const [notice, setNotice] = useState<Notice>();
  const [reveal, setReveal] = useState<ShopRerollResult>();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string>();
  // 구매가 성공할 때마다, 그리고 화면을 당겨서 새로고침할 때마다 올려 펼쳐 둔 "사용 내역"이 첫 페이지부터
  // 다시 불러오게 한다(PR #312 리뷰 6번).
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);

  async function refresh() {
    setRefreshing(true);
    setHistoryRefreshToken((value) => value + 1);
    try {
      const refreshed = await shop.refreshQuietly();
      // 새로고침이 서버의 최신 결과를 보여줬으면 그 전 구매 시도는 이미 끝난 일로 본다 — 다음 구매는 새
      // requestId로 시작해, 그 사이 응답을 놓친 옛 시도를 재생(replay)하지 않는다(PR #312 리뷰 2번).
      if (refreshed) setPending(undefined);
    } finally {
      setRefreshing(false);
    }
  }

  async function buy(grade: ShopGradeView) {
    if (busyGrade) return;
    const attempt = resumeOrStartPurchase(pending, grade.grade);
    setPending(attempt);
    setBusyGrade(grade.grade);
    setNotice(undefined);
    try {
      const result = await api.reroll({ grade: grade.grade, requestId: attempt.requestId, expectedRemaining: grade.remaining });
      setPending(undefined);
      shop.applyReroll(result);
      setReveal(result);
      setHistoryRefreshToken((value) => value + 1);
    } catch (error) {
      if (error instanceof ShopApiError && error.code === 'SHOP_STATE_CHANGED') {
        // 요금은 빠지지 않았으니(design-298.md 리뷰 6번) 이 requestId는 더 쓸 일이 없다. 새 공개 문구를 실제로
        // 보여줄 때까지는 구매를 막는다(finally의 setBusyGrade는 이 await 뒤에야 실행된다) — 낡은 확률 위에
        // "새로 보여드려요" 안내만 얹으면 안 된다(PR #312 리뷰 4번).
        setPending(undefined);
        const refreshed = await shop.refreshQuietly();
        setNotice({
          tone: 'error',
          text: refreshed ? shopErrorMessage(error) : '상품 정보를 다시 불러오지 못했어요. 아래로 당겨 새로고침한 뒤 다시 시도해 주세요.',
        });
      } else {
        setNotice({ tone: 'error', text: shopErrorMessage(error) });
      }
    } finally {
      setBusyGrade(undefined);
    }
  }

  async function chooseAvatar(itemId: string | null) {
    if (avatarBusy) return;
    setAvatarBusy(true);
    setNotice(undefined);
    setAvatarError(undefined);
    try {
      const { avatar } = await api.setAvatar(itemId);
      shop.applyAvatar(avatar);
      setReveal(undefined);
    } catch (error) {
      // 뽑기 연출(DrawReveal)이 열려 있는 동안의 실패는 그 안에서 보여준다 — 뒤에 깔린 알림은 전체 화면 모달에
      // 가려 아무도 못 본다(PR #312 리뷰 7번).
      if (reveal) setAvatarError(shopErrorMessage(error));
      else setNotice({ tone: 'error', text: shopErrorMessage(error) });
    } finally {
      setAvatarBusy(false);
    }
  }

  function confirmAvatar(cell: FriendGridCell) {
    if (!cell.owned || avatarBusy) return;
    if (cell.isAvatar) {
      Alert.alert('대표 해제', `${cell.name} 대표 설정을 해제할까요? 홈 화면에 다시 마스코트가 보여요.`, [
        { text: '취소', style: 'cancel' },
        { text: '해제', onPress: () => void chooseAvatar(null) },
      ]);
      return;
    }
    Alert.alert('대표로 설정', `${cell.name}을 대표 캐릭터로 설정할까요? 홈 화면 아바타에 보여요.`, [
      { text: '취소', style: 'cancel' },
      { text: '설정', onPress: () => void chooseAvatar(cell.id) },
    ]);
  }

  const header = (
    <AppHeader title={SHOP_TITLE} subtitle={SHOP_SUBTITLE}>
      <View style={styles.hero}>
        <Mascot interactive pose="gift" size={heroMascotSize(fontScale, 112)} />
      </View>
    </AppHeader>
  );
  const sky = (body: ReactNode) => (
    <SkyBackdrop>
      <SkyScrollView
        header={header}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} progressViewOffset={insets.top} colors={[palette.primary]} />}
      >
        {body}
      </SkyScrollView>
    </SkyBackdrop>
  );

  if (!shop.snapshot) {
    return shop.status === 'error'
      ? sky(<StateScene kind="error" title="상점을 불러오지 못했어요" body={shopErrorMessage(shop.error)} action={{ label: '다시 불러오기', onPress: () => { void shop.retry(); }, disabled: shop.retrying }} />)
      : sky(<StateScene kind="loading" title="상점을 불러오는 중" />);
  }

  const { snapshot } = shop;
  const grid = buildFriendGrid(snapshot.items, snapshot.avatar);

  return (
    <>
      {sky(
        <>
          <Stagger index={0}>
            <FloatingCard style={styles.card}>
              <View style={styles.mileageRow}>
                <Image source={mileageCoinArt} style={styles.coin} accessible={false} accessibilityIgnoresInvertColors />
                <Text accessibilityLabel={`마일리지 ${snapshot.mileage.balance}포인트`} style={styles.balance}>{formatMileage(snapshot.mileage.balance)}</Text>
              </View>
              <Text style={styles.rulesText}>{earnRulesText(snapshot.mileage.rules)}</Text>
              <View accessibilityLiveRegion="polite">
                {notice ? <Text style={notice.tone === 'success' ? styles.successMessage : styles.errorMessage}>{notice.text}</Text> : null}
              </View>
            </FloatingCard>
          </Stagger>

          <Stagger index={1}>
            <HistorySection api={api} refreshToken={historyRefreshToken} />
          </Stagger>

          <Stagger index={2}>
            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>재뽑기권</Text>
              {snapshot.grades.map((grade) => (
                <GradeRow
                  key={grade.grade}
                  grade={grade}
                  balance={snapshot.mileage.balance}
                  busy={busyGrade === grade.grade}
                  purchaseBusy={Boolean(busyGrade)}
                  onBuy={() => void buy(grade)}
                  styles={styles}
                />
              ))}
            </View>
          </Stagger>

          <Stagger index={3}>
            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>가게 친구</Text>
              <View style={styles.grid}>
                {grid.map((cell) => <FriendCell key={cell.id} cell={cell} onPress={() => confirmAvatar(cell)} styles={styles} />)}
              </View>
            </View>
          </Stagger>
        </>,
      )}
      {reveal ? (
        <DrawReveal
          result={reveal}
          isAvatar={snapshot.avatar === reveal.item.id}
          avatarBusy={avatarBusy}
          avatarError={avatarError}
          onSetAvatar={() => void chooseAvatar(reveal.item.id)}
          onClose={() => { setReveal(undefined); setAvatarError(undefined); }}
        />
      ) : null}
    </>
  );
}

function GradeRow({ grade, balance, busy, purchaseBusy, onBuy, styles }: {
  grade: ShopGradeView; balance: number; busy: boolean; purchaseBusy: boolean; onBuy: () => void;
  styles: ReturnType<typeof useShopStyles>;
}) {
  const button = rerollButtonState(grade, balance);
  // 다른 등급을 구매하는 동안에도 전부 비활성화한다 — 이 등급만 멀쩡해 보이면 눌러도 조용히 무시돼
  // 눌리지 않는 것처럼 보인다(PR #312 리뷰 8번). BounceButton이 disabled를 accessibilityState로도 알린다.
  const disabled = button.disabled || purchaseBusy;
  return (
    <FloatingCard style={styles.card}>
      <View style={styles.gradeHeader}>
        <Image source={ticketArt[grade.grade]} style={styles.ticket} accessible={false} accessibilityIgnoresInvertColors />
        <View style={styles.gradeCopy}>
          <Text style={styles.gradeName}>{gradeLabel(grade.grade)} 재뽑기권</Text>
          <Text style={styles.gradePrice}>{formatMileage(grade.price)} · 가진 친구 {grade.owned}/{grade.total}</Text>
        </View>
      </View>
      <Text style={styles.disclosure}>{rerollDisclosure(grade)}</Text>
      {button.reason ? <Text style={styles.disabledReason}>{button.reason}</Text> : null}
      <BounceButton
        label={busy ? '뽑는 중…' : '뽑기'}
        disabled={disabled}
        onPress={onBuy}
      />
    </FloatingCard>
  );
}

function FriendCell({ cell, onPress, styles }: {
  cell: FriendGridCell; onPress: () => void; styles: ReturnType<typeof useShopStyles>;
}) {
  const label = cell.owned
    ? `${cell.name}${cell.isAvatar ? ', 대표 캐릭터' : ', 가지고 있어요'}`
    : `${cell.name}, 아직 가지지 않았어요`;
  return (
    <Pressable
      accessibilityRole={cell.owned ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityHint={cell.owned ? (cell.isAvatar ? '대표 설정을 해제합니다' : '대표 캐릭터로 설정합니다') : undefined}
      disabled={!cell.owned}
      onPress={onPress}
      style={styles.cell}
    >
      <View style={[styles.cellRing, cell.isAvatar && styles.cellRingAvatar]}>
        {cell.owned
          ? <Image source={friendArt[cell.id]} style={styles.cellArt} accessible={false} accessibilityIgnoresInvertColors />
          : <Text style={styles.cellSilhouette}>?</Text>}
      </View>
      <Text numberOfLines={1} style={[styles.cellName, !cell.owned && styles.cellNameUnowned]}>{cell.owned ? cell.name : '???'}</Text>
      {cell.isAvatar ? <View style={styles.avatarChip}><Text style={styles.avatarChipText}>대표</Text></View> : null}
    </Pressable>
  );
}

function gradeLabel(grade: MileageGrade): string {
  return grade === 'BRONZE' ? '브론즈' : grade === 'SILVER' ? '실버' : '골드';
}
