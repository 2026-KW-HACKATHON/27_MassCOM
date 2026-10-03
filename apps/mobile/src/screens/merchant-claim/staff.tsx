import { CameraView, useCameraPermissions } from 'expo-camera';
import { BottomSheet, RNHostView } from '@expo/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createScanGate } from '@/commerce/claim-code';
import { ClaimQr } from '@/commerce/claim-qr';
import { CommerceApiError, createCommerceApiClient, type IssuedClaim, type ResolvedCustomerIdentity, type StaffCoupon } from '@/commerce/commerce-api';
import { canIssueCustomerIdentity, createIdentityRequestGate, customerIdentityCode, isCustomerIdentityExpired, parseCustomerIdentityToken } from '@/commerce/customer-identity';
import { colorsForScheme } from '@/theme/palette';
import { canUseCamera } from '@/ui/can-use-camera';
import { focusMerchantHeading } from '../merchant-home/focus-heading';
import { claimSecondsRemaining, merchantStepFor } from '../merchant-home/visit-step';
import { makeMerchantClaimStyles } from './styles';
import { claimQrSizeForArea, minimumClaimQrSize } from './qr-layout';

type StaffClaimProps = {
  apiUrl: string;
  merchantId: string;
  credential: AccountCredential;
  onSessionInvalid: () => void | Promise<void>;
  merchantName: string;
  active?: boolean;
};

export function StaffClaimScreen(props: StaffClaimProps) {
  const identity = JSON.stringify([props.apiUrl, props.merchantId, props.credential]);
  const [scope, setScope] = useState({ identity, credential: props.credential, callback: props.onSessionInvalid, version: 0 });
  // 점포·세션·클라이언트가 바뀌면 대기 상태도 새로 시작한다. 인증 값은 렌더링 키에 넣지 않는다.
  if (scope.identity !== identity || scope.credential !== props.credential || scope.callback !== props.onSessionInvalid) {
    setScope({ identity, credential: props.credential, callback: props.onSessionInvalid, version: scope.version + 1 });
  }
  return <StaffClaimSession key={scope.version} {...props} />;
}

function StaffClaimSession({ apiUrl, merchantId, credential, onSessionInvalid, merchantName, active = true }: StaffClaimProps) {
  const palette = colorsForScheme(useColorScheme());
  const styles = StyleSheet.create(makeMerchantClaimStyles(palette, StyleSheet.hairlineWidth));
  const insets = useSafeAreaInsets();
  const heading = useRef<Text>(null);
  const modalHeading = useRef<Text>(null);
  const { width, height } = useWindowDimensions();
  const [scanGate] = useState(createScanGate);
  const [requestGate] = useState(createIdentityRequestGate);
  const [, requestCameraPermission] = useCameraPermissions();
  const api = useMemo(() => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [scanning, setScanning] = useState(false);
  const [token, setToken] = useState<string>();
  const [resolved, setResolved] = useState<ResolvedCustomerIdentity>();
  const [issued, setIssued] = useState<IssuedClaim>();
  const [qrVisible, setQrVisible] = useState(false);
  const [issueAttempted, setIssueAttempted] = useState(false);
  const [issuedUncertain, setIssuedUncertain] = useState(false);
  const [coupons, setCoupons] = useState<readonly StaffCoupon[]>();
  const [couponMessage, setCouponMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponLoading, setCouponLoading] = useState(false);
  const [qrArea, setQrArea] = useState({ width: 0, height: 0 });
  const [now, setNow] = useState(() => Date.now());
  const step = merchantStepFor({ scanning, identified: Boolean(token), issued: Boolean(issued) });
  const seconds = issued ? claimSecondsRemaining(issued.expiresAt, now) : 0;
  const compact = width > height;
  const qrSize = claimQrSizeForArea(qrArea.width, qrArea.height);

  useEffect(() => {
    if (!active || qrVisible) return;
    const frame = requestAnimationFrame(() => focusMerchantHeading(heading.current));
    return () => cancelAnimationFrame(frame);
  }, [step, active, qrVisible]);
  useEffect(() => {
    if (!issued) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [issued]);
  // 점포·세션 변경과 화면 해제 시 이전 요청의 성공·실패·완료를 모두 무효화한다.
  useEffect(() => () => requestGate.cancel(), [api, merchantId, requestGate]);

  function done() {
    // 요청 중에도 닫고, 늦은 응답은 요청 세대로 무효화한다.
    cancel();
  }

  async function startScan() {
    const current = requestGate.start();
    const permission = await requestCameraPermission();
    if (!requestGate.isCurrent(current)) return;
    if (!permission.granted) {
      setMessage('카메라 권한이 필요합니다. 기기 설정에서 카메라를 허용한 뒤 다시 시도해 주세요.');
      return;
    }
    requestGate.cancel();
    scanGate.reset();
    setToken(undefined);
    setResolved(undefined);
    setIssued(undefined);
    setQrVisible(false);
    setIssueAttempted(false);
    setIssuedUncertain(false);
    setCouponLoading(false);
    setCoupons(undefined);
    setCouponMessage(undefined);
    setMessage(undefined);
    setScanning(true);
  }

  function cancel() {
    requestGate.cancel();
    setQrVisible(false);
    setIssued(undefined);
    setIssueAttempted(false);
    setIssuedUncertain(false);
    setBusy(false);
    setScanning(false);
    setCouponOpen(false);
    setToken(undefined);
    setResolved(undefined);
    setCouponLoading(false);
    setCoupons(undefined);
    setCouponMessage(undefined);
    setMessage(undefined);
  }

  async function resolve(nextToken: string) {
    const current = requestGate.start();
    setBusy(true);
    setMessage(undefined);
    try {
      const next = await api.resolveCustomerIdentity(merchantId, nextToken);
      if (!requestGate.isCurrent(current)) return;
      if (isCustomerIdentityExpired(next.expiresAt)) {
        setResolved(undefined);
        setMessage('고객 식별 QR이 만료됐습니다. 새 QR을 요청해 주세요.');
        return;
      }
      setResolved(next);
      setMessage('고객 화면과 확인 코드를 대조하고 실제 사용 여부를 확인해 주세요.');
      // 같은 식별 요청 세대에서 쿠폰도 읽는다. 실패해도 방문 확인은 계속할 수 있다.
      setCouponLoading(true);
      void api.lookupCustomerCoupons(merchantId, nextToken).then((lookup) => {
        if (requestGate.isCurrent(current)) setCoupons(lookup.coupons);
      }).catch((error: unknown) => {
        if (requestGate.isCurrent(current) && !closeExpiredIdentity(error)) setCouponMessage(messageFor(error));
      }).finally(() => {
        if (requestGate.isCurrent(current)) setCouponLoading(false);
      });
    } catch (error) {
      if (requestGate.isCurrent(current)) setMessage(messageFor(error));
    } finally {
      if (requestGate.isCurrent(current)) setBusy(false);
    }
  }

  function scanned(raw: string) {
    const nextToken = parseCustomerIdentityToken(raw);
    if (!nextToken) {
      setMessage('고객 식별 QR이 아닙니다. 고객 화면의 2분 QR을 비춰 주세요.');
      return;
    }
    if (!scanGate.accept(nextToken)) return;
    setScanning(false);
    setToken(nextToken);
    void resolve(nextToken);
  }

  async function lookupCoupons() {
    if (!token || !resolved || busy || couponLoading) return;
    if (isCustomerIdentityExpired(resolved.expiresAt)) {
      setCouponMessage('고객 식별 QR이 만료됐습니다. 새 QR을 요청해 주세요.');
      return;
    }
    const current = requestGate.start();
    setCouponLoading(true);
    setCouponMessage(undefined);
    try {
      const next = await api.lookupCustomerCoupons(merchantId, token);
      if (!requestGate.isCurrent(current)) return;
      setCoupons(next.coupons);
      setCouponMessage(next.coupons.length ? undefined : '이 점포에서 쓸 수 있는 쿠폰이 없어요');
    } catch (error) {
      if (requestGate.isCurrent(current) && !closeExpiredIdentity(error)) setCouponMessage(messageFor(error));
    } finally {
      if (requestGate.isCurrent(current)) setCouponLoading(false);
    }
  }

  // 식별 QR이 만료·무효가 되면 쿠폰 목록과 "사용 처리" 버튼을 남기지 않고 새 QR 촬영으로 돌아가게 한다.
  function closeExpiredIdentity(error: unknown): boolean {
    if (!(error instanceof CommerceApiError)
      || (error.code !== 'CUSTOMER_IDENTITY_EXPIRED' && error.code !== 'CUSTOMER_IDENTITY_UNAVAILABLE')) return false;
    setResolved(undefined);
    setToken(undefined);
    setCouponOpen(false);
    setCouponLoading(false);
    setCoupons(undefined);
    setCouponMessage(undefined);
    setMessage(messageFor(error));
    return true;
  }

  function confirmRedeem(coupon: StaffCoupon) {
    if (busy || couponLoading) return;
    // 확인창이 열린 동안 취소하거나 다시 촬영하면 이전 확인 요청을 무효화한다.
    const current = requestGate.start();
    Alert.alert(coupon.title, '고객이 이 혜택을 지금 받나요? 되돌릴 수 없어요', [
      { text: '취소', style: 'cancel' },
      { text: '사용 처리', style: 'destructive', onPress: () => void redeem(coupon, current) },
    ]);
  }

  async function redeem(coupon: StaffCoupon, current: number) {
    if (!token || !requestGate.isCurrent(current)) return;
    setBusy(true);
    setCouponMessage(undefined);
    try {
      const result = await api.redeemCustomerCoupon({ merchantId, couponId: coupon.couponId, customerIdentityToken: token });
      if (!requestGate.isCurrent(current)) return;
      setCoupons((list) => list?.filter((item) => item.couponId !== coupon.couponId));
      setCouponMessage(result.replayed ? '이미 사용 처리된 쿠폰이에요' : '쿠폰 사용을 처리했어요');
    } catch (error) {
      if (!requestGate.isCurrent(current)) return;
      if (closeExpiredIdentity(error)) return;
      if (error instanceof CommerceApiError && error.code === 'COUPON_EXPIRED') {
        setCoupons((list) => list?.filter((item) => item.couponId !== coupon.couponId));
      }
      setCouponMessage(messageFor(error));
    } finally {
      if (requestGate.isCurrent(current)) setBusy(false);
    }
  }

  async function issue() {
    if (!token || !resolved || busy) return;
    if (!canIssueCustomerIdentity(resolved.expiresAt, issueAttempted)) {
      setMessage('고객 식별 QR이 만료됐습니다. 새 QR을 요청해 주세요.');
      return;
    }
    const current = requestGate.start();
    setCouponLoading(false);
    setBusy(true);
    setMessage(undefined);
    setIssueAttempted(true);
    try {
      const next = await api.issueOrReissueIdentityClaim({ merchantId, customerIdentityToken: token });
      if (!requestGate.isCurrent(current)) return;
      setNow(Date.now());
      setCouponOpen(false);
      setIssued(next);
      setQrVisible(true);
      setResolved(undefined);
      setMessage('방문 코드를 발급했습니다. 고객이 아래 QR을 촬영해 수령을 확정합니다.');
    } catch (error) {
      if (!requestGate.isCurrent(current)) return;
      if (error instanceof CommerceApiError && error.code === 'CUSTOMER_IDENTITY_EXPIRED') {
        setResolved(undefined);
        setToken(undefined);
      }
      setMessage(messageFor(error));
    } finally {
      if (requestGate.isCurrent(current)) setBusy(false);
    }
  }

  async function reissue() {
    if (!issued || busy) return;
    const current = requestGate.start();
    setBusy(true);
    setIssuedUncertain(true);
    setMessage(undefined);
    try {
      const next = await api.reissueClaim({ merchantId, claimSlotId: issued.claimSlotId, expectedTokenVersion: issued.tokenVersion });
      if (!requestGate.isCurrent(current)) return;
      setIssued(next);
      setIssuedUncertain(false);
      setMessage('이전 코드를 폐기하고 새 코드로 교체했습니다.');
    } catch (error) {
      if (!requestGate.isCurrent(current)) return;
      setMessage(`${messageFor(error)} 재발급 결과가 불확실합니다. 아래에서 현재 코드를 복구해 주세요.`);
    } finally {
      if (requestGate.isCurrent(current)) setBusy(false);
    }
  }

  async function recoverCurrent() {
    if (!token || busy) return;
    const current = requestGate.start();
    setBusy(true);
    setIssuedUncertain(true);
    setMessage(undefined);
    try {
      const next = await api.issueOrReissueIdentityClaim({ merchantId, customerIdentityToken: token });
      if (!requestGate.isCurrent(current)) return;
      setIssued(next);
      setIssuedUncertain(false);
      setMessage('현재 방문 코드를 복구했습니다. 고객에게 아래 QR을 보여주세요.');
    } catch (error) {
      if (!requestGate.isCurrent(current)) return;
      setMessage(`${messageFor(error)} 현재 코드를 확인하지 못했습니다. 다시 시도하거나 고객에게 새 QR을 요청해 주세요.`);
    } finally {
      if (requestGate.isCurrent(current)) setBusy(false);
    }
  }

  return <View style={{ flex: 1 }}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={Platform.OS !== 'web'} contentContainerStyle={styles.content}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {['① 고객 QR 찍기', '② 고객 확인', '③ 방문 코드'].map((label, index) => <Text key={label} accessibilityLabel={`${label}${step === index + 1 ? ', 현재 단계' : ''}`} style={[styles.help, { flex: 1, color: step === index + 1 ? palette.primary : palette.secondaryLabel, fontWeight: '700' }]}>{label}</Text>)}
      </View>
      <Text ref={heading} accessible accessibilityRole="header" style={styles.cardLabel}>{step === 1 ? '고객 QR 찍기' : step === 2 ? '고객 확인' : '방문 코드'}</Text>
      <Text style={styles.help}>가상 점포의 체험용 방문 확인입니다. 실제 주문·방문 혜택이 아니며 서버가 점포 권한을 확인합니다.</Text>
      {step === 1 ? <View style={styles.formCard}>
        {canUseCamera ? <>
          {scanning && active ? <View style={{ height: 260, overflow: 'hidden', borderRadius: 14 }}>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => scanned(data)} />
          </View> : null}
          <Button styles={styles} label={scanning ? '촬영 취소' : '고객 QR 찍기'} disabled={busy} onPress={scanning ? cancel : () => void startScan()} />
        </> : <Text style={styles.help}>고객 QR 촬영은 카메라가 필요해 Android 앱에서만 할 수 있어요. 이 화면은 미리보기만 확인할 수 있어요.</Text>}
      </View> : null}
      {token && !issued ? <View style={styles.formCard}>
        <Text selectable style={[styles.cardLabel, { fontSize: 32, fontVariant: ['tabular-nums'] }]}>확인 코드 {customerIdentityCode(token)}</Text>
        <Text style={styles.help}>고객 화면의 코드와 일치하는지 확인하세요. 일치하지 않으면 취소하고 다시 촬영하세요.</Text>
        {resolved ? <Text style={styles.expiry}>식별 QR 만료: {new Date(resolved.expiresAt).toLocaleTimeString('ko-KR')}</Text> : null}
        {resolved ? <>
          {!issueAttempted ? <Button styles={styles} label={couponLoading ? '쿠폰 확인 중…' : coupons ? `쿠폰 ${coupons.length}장` : '이 고객 쿠폰 확인'} variant="secondary" disabled={busy} onPress={() => { setCouponOpen(true); if (!coupons && !couponLoading) void lookupCoupons(); }} /> : null}
          <Button styles={styles} label={busy ? '확인 중…' : issueAttempted ? '발급 결과 확인·복구' : '방문 코드 발급'} disabled={busy} onPress={() => void issue()} />
        </> : <Button styles={styles} label={busy ? '확인 중…' : '고객 다시 확인'} disabled={busy} onPress={() => void resolve(token)} />}
        <Button styles={styles} label="이 고객 취소" variant="secondary" disabled={busy && Boolean(resolved)} onPress={cancel} />
      </View> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
      {couponMessage && !couponOpen ? <Text accessibilityLiveRegion="polite" style={styles.message}>{couponMessage}</Text> : null}
    </ScrollView>
      <BottomSheet isPresented={couponOpen && active && Boolean(resolved)} onDismiss={() => setCouponOpen(false)} snapPoints={['full']} containerColor={palette.surface}>
        <RNHostView style={{ width: width - 32, height: Math.max(120, height - insets.top - insets.bottom - 72) }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
          <Text accessibilityRole="header" style={styles.cardLabel}>쿠폰 사용</Text>
          <Text style={styles.help}>방문 코드를 발급하면 이 식별 QR은 다시 쓸 수 없으니 쿠폰을 먼저 처리해 주세요.</Text>
          <Button styles={styles} label={couponLoading ? '확인 중…' : coupons ? '쿠폰 다시 확인' : '이 고객 쿠폰 확인'} disabled={busy || couponLoading} onPress={() => void lookupCoupons()} />
          {coupons?.length === 0 ? <Text style={styles.help}>이 점포에서 쓸 수 있는 쿠폰이 없어요</Text> : null}
          {couponMessage ? <Text accessibilityLiveRegion="polite" style={styles.message}>{couponMessage}</Text> : null}
          {coupons?.map((coupon) => <View key={coupon.couponId} style={styles.couponRow}>
            <Text selectable style={styles.couponTitle}>{coupon.title}</Text>
            {coupon.detail ? <Text selectable style={styles.help}>{coupon.detail}</Text> : null}
            <Text style={styles.expiry}>만료: {new Date(coupon.expiresAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</Text>
            <Button styles={styles} label="사용 처리" accessibilityLabel={`${coupon.title} 사용 처리`} disabled={busy || couponLoading} onPress={() => confirmRedeem(coupon)} />
          </View>)}
          <Button styles={styles} label="닫기" variant="secondary" onPress={() => setCouponOpen(false)} />
        </ScrollView>
        </RNHostView>
      </BottomSheet>
    <Modal visible={qrVisible && active} presentationStyle="fullScreen" animationType="fade" onShow={() => focusMerchantHeading(modalHeading.current)} onRequestClose={done}>
      {issued ? <View accessibilityViewIsModal style={{ flex: 1, gap: 12, paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8, backgroundColor: palette.background }}>
        <View style={{ flex: 1, minHeight: 0, flexDirection: compact ? 'row' : 'column', gap: 12 }}>
          <View onLayout={({ nativeEvent }) => setQrArea({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })} style={{ flex: 1, flexShrink: 0, minWidth: minimumClaimQrSize + 16, minHeight: minimumClaimQrSize + 16, alignItems: 'center', justifyContent: 'center' }}>
            {!issuedUncertain && seconds > 0 ? <ClaimQr code={issued.token} size={qrSize} /> : null}
          </View>
          <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
            <Text ref={modalHeading} accessible accessibilityRole="header" style={styles.cardLabel}>③ 방문 코드 · {merchantName}</Text>
            <Text style={[styles.expiry, { paddingVertical: 8 }]}>{seconds > 0 ? `남은 시간 ${Math.floor(seconds / 60)}분 ${seconds % 60}초` : '방문 코드가 만료됐습니다. 새 QR을 요청해 주세요.'}</Text>
            {issuedUncertain ? <Text style={styles.help}>이전 QR이 폐기됐을 수 있습니다. 현재 코드를 복구한 뒤 고객에게 보여주세요.</Text> : null}
            <Text style={styles.help}>고객이 QR을 촬영하고 확정해야 방문이 기록됩니다.</Text>
            {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
            {issuedUncertain ? <Button styles={styles} label={busy ? '복구 중…' : '현재 코드 복구'} disabled={busy} onPress={() => void recoverCurrent()} /> : <Button styles={styles} label="코드 관리" variant="secondary" disabled={busy} onPress={() => {
              const current = requestGate.start();
              Alert.alert('방문 코드 관리', '공유하거나 이전 코드를 폐기하고 재발급할 수 있어요.', [
                { text: '닫기', style: 'cancel' },
                { text: '안전하게 공유', onPress: () => { if (requestGate.isCurrent(current) && seconds > 0) void Share.share({ title: '월계 마스코트 1회 수령 코드', message: issued.token }).catch(() => { if (requestGate.isCurrent(current)) setMessage('공유를 완료하지 못했습니다. 다시 시도해 주세요.'); }); } },
                { text: '이전 코드 폐기·재발급', onPress: () => { if (requestGate.isCurrent(current)) void reissue(); } },
              ]);
            }} />}
          </ScrollView>
        </View>
        <View style={{ flexShrink: 0 }}>
          <Button styles={styles} label="다 됐어요" onPress={done} />
        </View>
      </View> : null}
    </Modal>
  </View>;
}

function Button({ styles, label, accessibilityLabel, onPress, disabled = false, variant = 'primary' }: {
  styles: ReturnType<typeof makeMerchantClaimStyles>;
  label: string;
  accessibilityLabel?: string;
  onPress(): void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} disabled={disabled} onPress={onPress} style={[styles.button, variant === 'secondary' && styles.secondaryButton, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, variant === 'secondary' && styles.secondaryButtonText]}>{label}</Text>
  </Pressable>;
}

function messageFor(error: unknown): string {
  if (error instanceof CommerceApiError) {
    const messages: Record<string, string> = {
      CUSTOMER_IDENTITY_UNAVAILABLE: '이 식별 QR은 사용할 수 없습니다. 고객에게 새 QR을 요청해 주세요.',
      CUSTOMER_IDENTITY_EXPIRED: '식별 QR이 만료됐습니다. 고객에게 새 QR을 요청해 주세요.',
      CLAIM_SLOT_ALREADY_EXISTS: '이 고객의 방문 코드가 이미 있습니다. 점포에서 발급 상태를 확인해 주세요.',
      CLAIM_SLOT_NOT_REISSUABLE: '이미 사용됐거나 만료된 코드는 재발급할 수 없습니다.',
      MERCHANT_ACCESS_DENIED: '이 점포의 방문 확인 권한이 없습니다.',
      COUPON_NOT_FOUND: '이 점포에서 쓸 수 없는 쿠폰이에요. 쿠폰을 다시 확인해 주세요.',
      COUPON_EXPIRED: '유효기간이 지난 쿠폰이에요.',
      COUPON_SELF_REDEEM: '본인 쿠폰은 직접 사용 처리할 수 없어요. 다른 직원에게 요청해 주세요.',
      ACCOUNT_DELETED: '고객 계정이 삭제돼 쿠폰을 사용할 수 없어요.',
    };
    return messages[error.code] ?? `요청 실패: ${error.code}`;
  }
  return 'API 연결에 실패했습니다. 연결을 확인하고 다시 시도해 주세요.';
}
