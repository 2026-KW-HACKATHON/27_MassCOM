import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import {
  type createCommerceApiClient,
  type RecentCouponRedemption,
  type RecentVisit,
  type VisitCancelReason,
} from '@/commerce/commerce-api';
import type { makeMerchantClaimStyles } from './styles';
import {
  cancelConfirmText,
  redemptionRowText,
  reversalNoteMaxLength,
  undoConfirmText,
  undoHint,
  visitCancelReasons,
  visitRowAccessibilityLabel,
  visitRowText,
} from './reversal-copy';
import { createReversalController, initialReversalState, type ReversalState } from './reversal-loader';

type Styles = ReturnType<typeof makeMerchantClaimStyles>;
type Api = ReturnType<typeof createCommerceApiClient>;
type CancelForm = { merchantId: string; openVisitId: string | undefined; reason: VisitCancelReason; note: string };
const blankForm = (merchantId: string): CancelForm => ({ merchantId, openVisitId: undefined, reason: 'WRONG_CUSTOMER', note: '' });

/**
 * 직원 화면의 "최근 방문 확인"과 "최근 쿠폰 사용" 카드(Issue #243). 오늘 이 점포의 방문 목록에서 잘못 확인한 방문을 취소하고
 * 사용 처리한 지 10분 안의 쿠폰을 되돌린다. 고객 계정 ID·이메일은 오지 않고 점포별 가림 표시만 보인다.
 * 되돌릴 수 있는지는 서버가 정하고(canCancel·canUndo) 실패 코드는 한국어 안내로 바꾼다.
 * 목록 읽기·낡은 응답 버리기·중복 누름 방지는 reversal-loader.ts(순수 로직, 시험 있음)가 맡고 이 화면은 그 상태를 그린다.
 */
export function StaffReversalCards({ api, merchantId, styles, refreshSignal = 0 }: { api: Api; merchantId: string; styles: Styles; refreshSignal?: number }) {
  const [rawState, setState] = useState<ReversalState>(initialReversalState);
  const [rawForm, setForm] = useState<CancelForm>(() => blankForm(merchantId));
  const controller = useRef<ReturnType<typeof createReversalController> | undefined>(undefined);
  // 다른 점포의 상태·입력은 그리지 않는다: 점포가 바뀐 첫 렌더에도 이전 점포의 목록과 열어 둔 취소 양식이 비치지 않는다.
  const { visits, redemptions, visitMessage, redemptionMessage, busy } =
    rawState.merchantId === merchantId ? rawState : initialReversalState;
  const form = rawForm.merchantId === merchantId ? rawForm : blankForm(merchantId);
  const { openVisitId, reason, note } = form;
  const patchForm = (patch: Partial<CancelForm>) => setForm({ ...form, ...patch });

  // 점포가 바뀌거나 화면이 닫히면 목록을 새로 읽고 늦게 온 응답을 버린다.
  useEffect(() => {
    const next = createReversalController(api, merchantId, setState);
    controller.current = next;
    void next.start();
    return () => {
      next.dispose();
      if (controller.current === next) controller.current = undefined;
    };
  }, [api, merchantId]);

  // 탭의 당겨서 새로 고침도 기존 컨트롤러를 사용한다.
  useEffect(() => {
    if (refreshSignal > 0) void controller.current?.refresh();
  }, [refreshSignal]);

  function confirmCancel(visit: RecentVisit) {
    if (busy) return;
    Alert.alert('방문 취소', cancelConfirmText(visit), [
      { text: '닫기', style: 'cancel' },
      { text: '방문 취소', style: 'destructive', onPress: () => void cancelVisit(visit) },
    ]);
  }

  async function cancelVisit(visit: RecentVisit) {
    if (!(await controller.current?.cancelVisit(visit, { reason, note }))) return;
    patchForm({ openVisitId: undefined, reason: 'WRONG_CUSTOMER', note: '' });
  }

  function confirmUndo(coupon: RecentCouponRedemption) {
    if (busy) return;
    Alert.alert('쿠폰 사용 되돌리기', undoConfirmText(coupon), [
      { text: '닫기', style: 'cancel' },
      { text: '사용 되돌리기', style: 'destructive', onPress: () => void controller.current?.undoCoupon(coupon) },
    ]);
  }

  return <>
    <View style={styles.formCard}>
      <Text accessibilityRole="header" style={styles.cardLabel}>최근 방문 확인</Text>
      <Text style={styles.help}>오늘(한국 시간) 이 점포에서 확인한 방문이에요. 잘못 확인했다면 그날 안에 취소할 수 있고, 이미 NFT를 발행했거나 발행 중인 방문은 취소되지 않아요.</Text>
      <Button styles={styles} label="목록 새로 고침" variant="secondary" disabled={busy} onPress={() => void controller.current?.refresh()} />
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
                onPress={() => patchForm({ reason: option.code })}
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
              accessibilityHint="100자까지 쓸 수 있어요. 연락처, 이메일, 주소, 이름은 적지 마세요."
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={reversalNoteMaxLength}
              onChangeText={(text) => patchForm({ note: text })}
              style={styles.input}
              value={note}
            />
            <Text style={styles.help}>연락처·이메일·주소·이름은 적지 마세요.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${visitRowAccessibilityLabel(visit)} 취소 확정`} disabled={busy} onPress={() => confirmCancel(visit)} style={[styles.dangerButton, busy && styles.disabled]}>
            <Text style={styles.dangerButtonText}>방문 취소 확정</Text>
          </Pressable>
          <Button styles={styles} label="닫기" variant="secondary" disabled={busy} onPress={() => patchForm({ openVisitId: undefined, note: '' })} />
        </> : <Button
          styles={styles}
          label="방문 취소"
          accessibilityLabel={`${visitRowAccessibilityLabel(visit)} 방문 취소 시작`}
          variant="secondary"
          disabled={busy}
          onPress={() => patchForm({ openVisitId: visit.visitEventId, reason: 'WRONG_CUSTOMER', note: '' })}
        /> : null}
      </View>)}
    </View>
    <View style={styles.formCard}>
      <Text accessibilityRole="header" style={styles.cardLabel}>최근 쿠폰 사용</Text>
      <Text style={styles.help}>최근 24시간 안에 이 점포에서 사용 처리한 쿠폰이에요. 사용 처리한 지 10분 안에는 되돌릴 수 있어요.</Text>
      <Button styles={styles} label="쿠폰 목록 새로 고침" variant="secondary" disabled={busy} onPress={() => void controller.current?.refresh()} />
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
