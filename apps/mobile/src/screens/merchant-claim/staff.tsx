import { CameraView, useCameraPermissions } from 'expo-camera';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createScanGate } from '@/commerce/claim-code';
import { ClaimQr } from '@/commerce/claim-qr';
import { CommerceApiError, createCommerceApiClient, type IssuedClaim, type ResolvedCustomerIdentity, type StaffCoupon } from '@/commerce/commerce-api';
import { canIssueCustomerIdentity, createIdentityRequestGate, customerIdentityCode, isCustomerIdentityExpired, parseCustomerIdentityToken } from '@/commerce/customer-identity';
import { colorsForScheme } from '@/theme/palette';
import { makeMerchantClaimStyles } from './styles';

export function StaffClaimScreen({ apiUrl, merchantId, credential, onSessionInvalid }: {
  apiUrl: string;
  merchantId: string;
  credential: AccountCredential;
  onSessionInvalid: () => void | Promise<void>;
}) {
  const palette = colorsForScheme(useColorScheme());
  const styles = StyleSheet.create(makeMerchantClaimStyles(palette, StyleSheet.hairlineWidth));
  const insets = useSafeAreaInsets();
  const scrollView = useRef<ScrollView>(null);
  const scanGate = useRef(createScanGate()).current;
  const requestGate = useRef(createIdentityRequestGate()).current;
  const [, requestCameraPermission] = useCameraPermissions();
  const api = useMemo(() => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [scanning, setScanning] = useState(false);
  const [token, setToken] = useState<string>();
  const [resolved, setResolved] = useState<ResolvedCustomerIdentity>();
  const [issued, setIssued] = useState<IssuedClaim>();
  const [issueAttempted, setIssueAttempted] = useState(false);
  const [issuedUncertain, setIssuedUncertain] = useState(false);
  const [coupons, setCoupons] = useState<readonly StaffCoupon[]>();
  const [couponMessage, setCouponMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function startScan() {
    const permission = await requestCameraPermission();
    if (!permission.granted) {
      setMessage('카메라 권한이 필요합니다. 기기 설정에서 카메라를 허용한 뒤 다시 시도해 주세요.');
      return;
    }
    requestGate.cancel();
    scanGate.reset();
    setToken(undefined);
    setResolved(undefined);
    setIssued(undefined);
    setIssueAttempted(false);
    setIssuedUncertain(false);
    setCoupons(undefined);
    setCouponMessage(undefined);
    setMessage(undefined);
    setScanning(true);
  }

  function cancel() {
    requestGate.cancel();
    setBusy(false);
    setScanning(false);
    setToken(undefined);
    setResolved(undefined);
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
    if (!token || !resolved || busy) return;
    if (isCustomerIdentityExpired(resolved.expiresAt)) {
      setCouponMessage('고객 식별 QR이 만료됐습니다. 새 QR을 요청해 주세요.');
      return;
    }
    const current = requestGate.start();
    setBusy(true);
    setCouponMessage(undefined);
    try {
      const next = await api.lookupCustomerCoupons(merchantId, token);
      if (!requestGate.isCurrent(current)) return;
      setCoupons(next.coupons);
      setCouponMessage(next.coupons.length ? undefined : '이 점포에서 쓸 수 있는 쿠폰이 없어요');
    } catch (error) {
      if (requestGate.isCurrent(current) && !closeExpiredIdentity(error)) setCouponMessage(messageFor(error));
    } finally {
      if (requestGate.isCurrent(current)) setBusy(false);
    }
  }

  // 식별 QR이 만료·무효가 되면 쿠폰 목록과 "사용 처리" 버튼을 남기지 않고 새 QR 촬영으로 돌아가게 한다.
  function closeExpiredIdentity(error: unknown): boolean {
    if (!(error instanceof CommerceApiError)
      || (error.code !== 'CUSTOMER_IDENTITY_EXPIRED' && error.code !== 'CUSTOMER_IDENTITY_UNAVAILABLE')) return false;
    setResolved(undefined);
    setToken(undefined);
    setCoupons(undefined);
    setCouponMessage(undefined);
    setMessage(messageFor(error));
    return true;
  }

  function confirmRedeem(coupon: StaffCoupon) {
    if (busy) return;
    // Advancing the gate invalidates this confirmation if staff cancels or rescans while the alert is open.
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
    setBusy(true);
    setMessage(undefined);
    setIssueAttempted(true);
    try {
      const next = await api.issueOrReissueIdentityClaim({ merchantId, customerIdentityToken: token });
      setIssued(next);
      setResolved(undefined);
      setMessage('방문 코드를 발급했습니다. 고객이 아래 QR을 촬영해 수령을 확정합니다.');
      requestAnimationFrame(() => scrollView.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      if (error instanceof CommerceApiError && error.code === 'CUSTOMER_IDENTITY_EXPIRED') {
        setResolved(undefined);
        setToken(undefined);
      }
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function reissue() {
    if (!issued || busy) return;
    setBusy(true);
    setIssuedUncertain(true);
    setMessage(undefined);
    try {
      const next = await api.reissueClaim({ merchantId, claimSlotId: issued.claimSlotId, expectedTokenVersion: issued.tokenVersion });
      setIssued(next);
      setIssuedUncertain(false);
      setMessage('이전 코드를 폐기하고 새 코드로 교체했습니다.');
    } catch (error) {
      setMessage(`${messageFor(error)} 재발급 결과가 불확실합니다. 아래에서 현재 코드를 복구해 주세요.`);
    } finally {
      setBusy(false);
    }
  }

  async function recoverCurrent() {
    if (!token || busy) return;
    setBusy(true);
    setIssuedUncertain(true);
    setMessage(undefined);
    try {
      const next = await api.issueOrReissueIdentityClaim({ merchantId, customerIdentityToken: token });
      setIssued(next);
      setIssuedUncertain(false);
      setMessage('현재 방문 코드를 복구했습니다. 고객에게 아래 QR을 보여주세요.');
    } catch (error) {
      setMessage(`${messageFor(error)} 현재 코드를 확인하지 못했습니다. 다시 시도하거나 고객에게 새 QR을 요청해 주세요.`);
    } finally {
      setBusy(false);
    }
  }

  return <ScrollView ref={scrollView} contentInsetAdjustmentBehavior="automatic" style={{ flex: 1 }} contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom }]}>
    <View style={styles.hero}>
      <Text style={styles.eyebrow}>체험용 점주·직원 화면</Text>
      <Text selectable style={styles.title}>고객 QR로{`\n`}방문을 확인합니다.</Text>
      <Text selectable style={styles.body}>가상 점포의 체험용 방문 확인입니다. 실제 주문·방문 혜택이 아니며 서버가 점포 권한을 확인합니다.</Text>
    </View>
    <View style={styles.formCard}>
      <Text style={styles.cardLabel}>1 · 고객 식별</Text>
      {scanning ? <View style={{ height: 260, overflow: 'hidden', borderRadius: 14 }}>
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => scanned(data)} />
      </View> : null}
      <Button styles={styles} label={scanning ? '촬영 취소' : '고객 식별 QR 촬영'} disabled={busy} onPress={scanning ? cancel : () => void startScan()} />
      {token && !issued ? <>
        <Text selectable style={styles.cardLabel}>확인 코드 {customerIdentityCode(token)}</Text>
        <Text style={styles.help}>고객 화면의 코드와 일치하는지 확인하세요. 일치하지 않으면 취소하고 다시 촬영하세요.</Text>
        {resolved ? <Text style={styles.expiry}>식별 QR 만료: {new Date(resolved.expiresAt).toLocaleTimeString('ko-KR')}</Text> : null}
        {resolved ? <Button styles={styles} label={busy ? '확인 중…' : issueAttempted ? '발급 결과 확인·복구' : '실제 사용 확인 · 방문 코드 발급'} disabled={busy} onPress={() => void issue()} /> : null}
        <Button styles={styles} label="이 고객 취소" variant="secondary" disabled={busy && Boolean(resolved)} onPress={cancel} />
      </> : null}
    </View>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    {resolved && !issued && !issueAttempted ? <View style={styles.formCard}>
      <Text style={styles.cardLabel}>쿠폰 사용</Text>
      <Text style={styles.help}>이 고객이 이 점포에서 쓸 쿠폰을 확인해요. 방문 코드를 발급하면 이 식별 QR은 다시 쓸 수 없으니 쿠폰을 먼저 처리해 주세요.</Text>
      <Button styles={styles} label={busy ? '확인 중…' : coupons ? '쿠폰 다시 확인' : '이 고객 쿠폰 확인'} disabled={busy} onPress={() => void lookupCoupons()} />
      {couponMessage ? <Text accessibilityLiveRegion="polite" style={styles.message}>{couponMessage}</Text> : null}
      {coupons?.map((coupon) => <View key={coupon.couponId} style={styles.couponRow}>
        <Text selectable style={styles.couponTitle}>{coupon.title}</Text>
        {coupon.detail ? <Text selectable style={styles.help}>{coupon.detail}</Text> : null}
        <Text style={styles.expiry}>만료: {new Date(coupon.expiresAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</Text>
        <Button styles={styles} label="사용 처리" accessibilityLabel={`${coupon.title} 사용 처리`} disabled={busy} onPress={() => confirmRedeem(coupon)} />
      </View>)}
    </View> : null}
    {issued ? <View style={styles.tokenCard}>
      <Text style={styles.tokenLabel}>2 · 고객 수령 QR · v{issued.tokenVersion}</Text>
      <Text style={styles.expiry}>만료: {new Date(issued.expiresAt).toLocaleString('ko-KR')}</Text>
      {issuedUncertain ? <Text style={styles.help}>이전 QR이 폐기됐을 수 있습니다. 현재 코드를 복구한 뒤 고객에게 보여주세요.</Text> : <>
        <View style={styles.qr}><ClaimQr code={issued.token} /></View>
        <Text selectable style={styles.token}>{issued.token}</Text>
        <Text style={styles.help}>고객이 자신의 방문 수령 화면에서 촬영하고 확정해야 방문이 기록됩니다.</Text>
      </>}
      <View style={styles.actions}>
        {issuedUncertain ? <Button styles={styles} label={busy ? '복구 중…' : '현재 코드 복구'} disabled={busy} onPress={() => void recoverCurrent()} /> : <>
          <Button styles={styles} label="안전하게 공유" onPress={() => void Share.share({ title: '월계 마스코트 1회 수령 코드', message: issued.token })} />
          <Button styles={styles} label="이전 코드 폐기·재발급" variant="secondary" disabled={busy} onPress={() => void reissue()} />
        </>}
      </View>
    </View> : null}
  </ScrollView>;
}

function Button({ styles, label, accessibilityLabel, onPress, disabled = false, variant = 'primary' }: {
  styles: ReturnType<typeof makeMerchantClaimStyles>;
  label: string;
  accessibilityLabel?: string;
  onPress(): void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={[styles.button, variant === 'secondary' && styles.secondaryButton, disabled && styles.disabled]}>
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
