import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import {
  CommerceApiError,
  type createCommerceApiClient,
  type RecentCouponRedemption,
  type RecentVisit,
  type VisitCancelReason,
} from '@/commerce/commerce-api';
import type { makeMerchantClaimStyles } from './styles';
import {
  cancelConfirmText,
  cancelSuccessMessage,
  listFailureMessage,
  redemptionRowText,
  reversalNoteMaxLength,
  staleAfterUndoFailure,
  staleAfterVisitFailure,
  undoConfirmText,
  undoFailureMessage,
  undoHint,
  undoSuccessMessage,
  visitCancelFailureMessage,
  visitCancelReasons,
  visitRowAccessibilityLabel,
  visitRowText,
} from './reversal-copy';

type Styles = ReturnType<typeof makeMerchantClaimStyles>;
type Api = ReturnType<typeof createCommerceApiClient>;

/**
 * 직원 화면의 "최근 방문 확인"과 "최근 쿠폰 사용" 카드(Issue #243). 오늘 이 점포의 방문 목록에서 잘못 확인한 방문을 취소하고
 * 사용 처리한 지 10분 안의 쿠폰을 되돌린다. 고객 계정 ID·이메일은 오지 않고 점포별 가림 표시만 보인다.
 * 되돌릴 수 있는지는 서버가 정하고(canCancel·canUndo) 실패 코드는 한국어 안내로 바꾼다.
 */
export function StaffReversalCards({ api, merchantId, styles }: { api: Api; merchantId: string; styles: Styles }) {
  const [visits, setVisits] = useState<readonly RecentVisit[]>();
  const [redemptions, setRedemptions] = useState<readonly RecentCouponRedemption[]>();
  const [visitMessage, setVisitMessage] = useState<string | undefined>('최근 방문을 불러오는 중이에요.');
  const [redemptionMessage, setRedemptionMessage] = useState<string | undefined>('최근 쿠폰 사용을 불러오는 중이에요.');
  const [openVisitId, setOpenVisitId] = useState<string>();
  const [reason, setReason] = useState<VisitCancelReason>('WRONG_CUSTOMER');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // 점포·계정이 바뀌거나 화면이 닫힌 뒤 늦게 온 응답이 목록을 되살리지 않게 한다.
  const generation = useRef(0);

  const fetchLists = useCallback(() => Promise.allSettled([
    api.listRecentVisits(merchantId),
    api.listRecentCouponRedemptions(merchantId),
  ]), [api, merchantId]);

  const applyLists = useCallback((
    [visitResult, redemptionResult]: Awaited<ReturnType<typeof fetchLists>>,
    keep: { visits?: boolean; redemptions?: boolean },
  ) => {
    if (visitResult.status === 'fulfilled') {
      setVisits(visitResult.value.visits);
      if (!keep.visits) {
        setVisitMessage(visitResult.value.visits.length ? undefined : '오늘 확인한 방문이 없어요.');
      }
    } else {
      setVisits(undefined);
      const error = visitResult.reason;
      setVisitMessage(listFailureMessage(error instanceof CommerceApiError ? error.status : undefined,
        error instanceof CommerceApiError ? error.code : '', '방문'));
    }
    if (redemptionResult.status === 'fulfilled') {
      setRedemptions(redemptionResult.value);
      if (!keep.redemptions) {
        setRedemptionMessage(redemptionResult.value.length ? undefined : '최근 24시간 안에 사용 처리한 쿠폰이 없어요.');
      }
    } else {
      setRedemptions(undefined);
      const error = redemptionResult.reason;
      setRedemptionMessage(listFailureMessage(error instanceof CommerceApiError ? error.status : undefined,
        error instanceof CommerceApiError ? error.code : '', '쿠폰 사용'));
    }
  }, []);

  const load = useCallback(async (keep: { visits?: boolean; redemptions?: boolean } = {}) => {
    const current = ++generation.current;
    const results = await fetchLists();
    if (current === generation.current) applyLists(results, keep);
  }, [fetchLists, applyLists]);

  // 처음에는 위 초기 문구가 "불러오는 중"을 알린다. 새로 고침은 문구를 먼저 바꾼 뒤 읽는다.
  const refresh = useCallback(() => {
    setVisitMessage('최근 방문을 불러오는 중이에요.');
    setRedemptionMessage('최근 쿠폰 사용을 불러오는 중이에요.');
    void load();
  }, [load]);

  useEffect(() => {
    const current = ++generation.current;
    void fetchLists().then((results) => {
      if (current === generation.current) applyLists(results, {});
    });
    return () => { generation.current += 1; };
  }, [fetchLists, applyLists]);

  function confirmCancel(visit: RecentVisit) {
    if (busy) return;
    Alert.alert('방문 취소', cancelConfirmText(visit), [
      { text: '닫기', style: 'cancel' },
      { text: '방문 취소', style: 'destructive', onPress: () => void cancelVisit(visit) },
    ]);
  }

  async function cancelVisit(visit: RecentVisit) {
    setBusy(true);
    setVisitMessage('방문을 취소하는 중이에요.');
    try {
      const result = await api.cancelVisit({ merchantId, visitEventId: visit.visitEventId, reason, note });
      setVisitMessage(cancelSuccessMessage(result));
      setOpenVisitId(undefined);
      setNote('');
      setReason('WRONG_CUSTOMER');
      await load({ visits: true });
    } catch (error) {
      const code = error instanceof CommerceApiError ? error.code : '';
      setVisitMessage(visitCancelFailureMessage(error instanceof CommerceApiError ? error.status : undefined, code));
      if (staleAfterVisitFailure(code)) await load({ visits: true });
    } finally {
      setBusy(false);
    }
  }

  function confirmUndo(coupon: RecentCouponRedemption) {
    if (busy) return;
    Alert.alert('쿠폰 사용 되돌리기', undoConfirmText(coupon), [
      { text: '닫기', style: 'cancel' },
      { text: '사용 되돌리기', style: 'destructive', onPress: () => void undoCoupon(coupon) },
    ]);
  }

  async function undoCoupon(coupon: RecentCouponRedemption) {
    setBusy(true);
    setRedemptionMessage('쿠폰 사용을 되돌리는 중이에요.');
    try {
      const result = await api.undoCouponRedemption({ merchantId, couponId: coupon.couponId });
      setRedemptionMessage(undoSuccessMessage(result));
      await load({ redemptions: true });
    } catch (error) {
      const code = error instanceof CommerceApiError ? error.code : '';
      setRedemptionMessage(undoFailureMessage(error instanceof CommerceApiError ? error.status : undefined, code));
      if (staleAfterUndoFailure(code)) await load({ redemptions: true });
    } finally {
      setBusy(false);
    }
  }

  return <>
    <View style={styles.formCard}>
      <Text accessibilityRole="header" style={styles.cardLabel}>최근 방문 확인</Text>
      <Text style={styles.help}>오늘(한국 시간) 이 점포에서 확인한 방문이에요. 잘못 확인했다면 그날 안에 취소할 수 있고, 이미 NFT를 발행했거나 발행 중인 방문은 취소되지 않아요.</Text>
      <Button styles={styles} label="목록 새로 고침" variant="secondary" disabled={busy} onPress={refresh} />
      {visitMessage ? <Text accessibilityLiveRegion="polite" style={styles.message}>{visitMessage}</Text> : null}
      {visits?.map((visit) => <View key={visit.visitEventId} style={styles.couponRow}>
        <Text selectable accessibilityLabel={visitRowAccessibilityLabel(visit)} style={styles.couponTitle}>{visitRowText(visit)}</Text>
        {visit.canCancel ? openVisitId === visit.visitEventId ? <>
          <Text style={styles.inputLabel}>취소 사유</Text>
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {visitCancelReasons.map((option) => {
              const selected = reason === option.code;
              return <Pressable
                key={option.code}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={option.label}
                disabled={busy}
                onPress={() => setReason(option.code)}
                style={[styles.reasonOption, selected && styles.reasonOptionSelected]}
              >
                <Text style={[styles.reasonOptionText, selected && styles.reasonOptionTextSelected]}>{option.label}</Text>
              </Pressable>;
            })}
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>메모(선택)</Text>
            <TextInput
              accessibilityLabel="취소 메모, 선택 사항"
              accessibilityHint="100자까지 쓸 수 있어요. 연락처, 이메일, 주소는 적지 마세요."
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={reversalNoteMaxLength}
              onChangeText={setNote}
              style={styles.input}
              value={note}
            />
            <Text style={styles.help}>연락처·이메일·주소는 적지 마세요.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${visitRowAccessibilityLabel(visit)} 취소 확정`} disabled={busy} onPress={() => confirmCancel(visit)} style={[styles.dangerButton, busy && styles.disabled]}>
            <Text style={styles.dangerButtonText}>방문 취소 확정</Text>
          </Pressable>
          <Button styles={styles} label="닫기" variant="secondary" disabled={busy} onPress={() => { setOpenVisitId(undefined); setNote(''); }} />
        </> : <Button
          styles={styles}
          label="방문 취소"
          accessibilityLabel={`${visitRowAccessibilityLabel(visit)} 방문 취소 시작`}
          variant="secondary"
          disabled={busy}
          onPress={() => { setOpenVisitId(visit.visitEventId); setReason('WRONG_CUSTOMER'); setNote(''); }}
        /> : null}
      </View>)}
    </View>
    <View style={styles.formCard}>
      <Text accessibilityRole="header" style={styles.cardLabel}>최근 쿠폰 사용</Text>
      <Text style={styles.help}>최근 24시간 안에 이 점포에서 사용 처리한 쿠폰이에요. 사용 처리한 지 10분 안에는 되돌릴 수 있어요.</Text>
      {redemptionMessage ? <Text accessibilityLiveRegion="polite" style={styles.message}>{redemptionMessage}</Text> : null}
      {redemptions?.map((coupon) => <View key={coupon.couponId} style={styles.couponRow}>
        <Text selectable style={styles.couponTitle}>{redemptionRowText(coupon)}</Text>
        <Text style={styles.expiry}>{undoHint(coupon)}</Text>
        {coupon.canUndo ? <Button
          styles={styles}
          label="사용 되돌리기"
          accessibilityLabel={`${coupon.title} ${coupon.customerLabel} 사용 되돌리기`}
          variant="danger"
          disabled={busy}
          onPress={() => confirmUndo(coupon)}
        /> : null}
      </View>)}
    </View>
  </>;
}

function Button({ styles, label, accessibilityLabel, onPress, disabled = false, variant = 'primary' }: {
  styles: Styles;
  label: string;
  accessibilityLabel?: string;
  onPress(): void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const buttonStyle = variant === 'danger' ? styles.dangerButton : [styles.button, variant === 'secondary' && styles.secondaryButton];
  const textStyle = variant === 'danger' ? styles.dangerButtonText : [styles.buttonText, variant === 'secondary' && styles.secondaryButtonText];
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={[buttonStyle, disabled && styles.disabled]}>
    <Text style={textStyle}>{label}</Text>
  </Pressable>;
}
