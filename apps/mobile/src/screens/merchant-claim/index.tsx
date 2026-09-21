import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CommerceApiError,
  createCommerceApiClient,
  type IssuedClaim,
  type MerchantContext,
} from '@/commerce/commerce-api';
import { ClaimQr } from '@/commerce/claim-qr';
import { createDemoCredential } from '@/config/demo-runtime';
import { colors } from '@/theme/colors';

type Props = {
  apiUrl: string;
  accountId: string;
  merchantId: string;
  defaultCustomerAccountId?: string;
};

export function MerchantClaimScreen({ apiUrl, accountId, merchantId, defaultCustomerAccountId = '' }: Props) {
  const scrollView = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const api = useMemo(
    () => createCommerceApiClient({ apiUrl, credential: createDemoCredential(accountId) }),
    [accountId, apiUrl],
  );
  const [context, setContext] = useState<MerchantContext>();
  const [contextError, setContextError] = useState<string>();
  const [customerAccountId, setCustomerAccountId] = useState(defaultCustomerAccountId);
  const [merchantReference, setMerchantReference] = useState(() => `demo-${Date.now()}`);
  const [issued, setIssued] = useState<IssuedClaim>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    void api
      .getMerchantContext(merchantId)
      .then((next) => {
        if (active) setContext(next);
      })
      .catch((error: unknown) => {
        if (active) setContextError(messageFor(error));
      });
    return () => {
      active = false;
    };
  }, [api, merchantId]);

  async function issue() {
    if (!customerAccountId.trim() || !merchantReference.trim() || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const next = await api.issueClaim({
        merchantId,
        customerAccountId: customerAccountId.trim(),
        merchantReference: merchantReference.trim(),
      });
      setIssued(next);
      setMessage('1인용 수령 코드를 발급했습니다. 같은 주문 참조는 다시 발급되지 않습니다.');
      requestAnimationFrame(() => scrollView.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function reissue() {
    if (!issued || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const next = await api.reissueClaim({
        merchantId,
        claimSlotId: issued.claimSlotId,
        expectedTokenVersion: issued.tokenVersion,
      });
      setIssued(next);
      setMessage('같은 슬롯의 이전 코드를 폐기하고 새 코드로 교체했습니다.');
      requestAnimationFrame(() => scrollView.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function shareToken() {
    if (!issued) return;
    await Share.share({
      title: '월계 마스코트 1회 수령 코드',
      message: issued.token,
    });
  }

  return (
    <ScrollView
      ref={scrollView}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom }]}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>점주·직원 개발 화면</Text>
        <Text selectable style={styles.title}>한 사람에게 쓸 수 있는{`\n`}방문 코드를 만듭니다.</Text>
        <Text selectable style={styles.body}>
          운영에서는 사용할 수 없는 로컬 직원 DEMO 화면입니다. 현재 loopback 시연 계정의 점포 권한을 서버에서 매번 확인합니다.
        </Text>
      </View>

      <View style={styles.contextCard}>
        <Text style={styles.cardLabel}>권한 확인</Text>
        {context ? (
          <>
            <InfoRow label="점포" value={context.merchantId} />
            <InfoRow label="역할" value={context.role} />
            <InfoRow label="권한" value={context.permissions.join(' · ')} />
          </>
        ) : contextError ? (
          <Text style={styles.errorText}>{contextError}</Text>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>

      <View style={styles.formCard}>
        <Text style={styles.cardLabel}>발급 대상</Text>
        <LabeledInput
          label="고객 데모 계정"
          value={customerAccountId}
          onChangeText={setCustomerAccountId}
          placeholder="customer-account-id"
        />
        <LabeledInput
          label="점포 주문 참조"
          value={merchantReference}
          onChangeText={setMerchantReference}
          placeholder="실제 주문번호 대신 시연 참조"
        />
        <Text style={styles.help}>주문 참조 원문은 서버 DB에 저장하지 않고 점포 범위 HMAC으로만 비교합니다.</Text>
        <PrimaryButton
          label={busy ? '발급 중…' : '1회 수령 코드 발급'}
          disabled={!context || busy || !customerAccountId.trim() || !merchantReference.trim()}
          onPress={issue}
        />
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {issued ? (
        <View style={styles.tokenCard}>
          <View style={styles.tokenTopline}>
            <Text style={styles.tokenLabel}>QR용 1회 코드 · v{issued.tokenVersion}</Text>
            <Text style={styles.expiry}>{formatDateTime(issued.expiresAt)} 만료</Text>
          </View>
          <View style={styles.qr}>
            <ClaimQr code={issued.token} />
          </View>
          <Text selectable style={styles.token}>{issued.token}</Text>
          <Text style={styles.help}>고객 화면의 ‘QR 촬영’으로 읽습니다. 카메라를 쓸 수 없으면 아래 코드를 직접 입력합니다.</Text>
          <View style={styles.actions}>
            <PrimaryButton label="안전하게 공유" onPress={shareToken} />
            <PrimaryButton label="이전 코드 폐기·재발급" variant="secondary" disabled={busy} onPress={reissue} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function LabeledInput({ label, ...props }: { label: string; value: string; onChangeText(value: string): void; placeholder: string }) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        {...props}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholderTextColor={colors.secondaryLabel}
      />
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text selectable style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled = false, variant = 'primary' }: { label: string; onPress(): void; disabled?: boolean; variant?: 'primary' | 'secondary' }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, variant === 'secondary' && styles.secondaryButton, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, variant === 'secondary' && styles.secondaryButtonText]}>{label}</Text>
    </Pressable>
  );
}

function messageFor(error: unknown): string {
  if (error instanceof CommerceApiError) {
    const messages: Record<string, string> = {
      MERCHANT_ACCESS_DENIED: '이 데모 계정에는 해당 점포의 발급 권한이 없습니다.',
      CLAIM_SLOT_ALREADY_EXISTS: '같은 고객·주문 참조로 만든 슬롯이 이미 있습니다.',
      CLAIM_SLOT_NOT_REISSUABLE: '이미 사용됐거나 버전이 바뀐 코드는 재발급할 수 없습니다.',
      ACCOUNT_AUTH_NOT_CONFIGURED: 'loopback 개발 계정 모드가 꺼져 있습니다.',
    };
    return messages[error.code] ?? `요청 실패: ${error.code}`;
  }
  return 'API 연결에 실패했습니다. 로컬 서버와 계정 설정을 확인해 주세요.';
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  content: { gap: 18, padding: 20, paddingBottom: 48, backgroundColor: colors.background },
  hero: { gap: 10 },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  title: { color: colors.label, fontSize: 31, fontWeight: '900', lineHeight: 39, letterSpacing: -0.6 },
  body: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 24 },
  contextCard: { gap: 8, padding: 18, borderRadius: 20, backgroundColor: colors.primaryContainer },
  formCard: { gap: 14, padding: 18, borderRadius: 20, backgroundColor: colors.surface },
  cardLabel: { color: colors.label, fontSize: 17, fontWeight: '900' },
  infoRow: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  infoLabel: { color: colors.onPrimaryContainer, fontSize: 13, fontWeight: '700' },
  infoValue: { flex: 1, color: colors.onPrimaryContainer, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  inputGroup: { gap: 7 },
  inputLabel: { color: colors.label, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 50, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.separator, color: colors.label, backgroundColor: colors.background, fontSize: 15 },
  help: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 19 },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.primary },
  secondaryButton: { borderWidth: 1, borderColor: colors.primary, backgroundColor: 'transparent' },
  buttonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  secondaryButtonText: { color: colors.primary },
  disabled: { opacity: 0.42 },
  message: { padding: 13, borderRadius: 14, color: colors.onPrimaryContainer, backgroundColor: colors.primaryContainer, fontSize: 13, lineHeight: 20 },
  errorText: { color: colors.onErrorContainer, fontSize: 13, lineHeight: 20 },
  qr: { alignItems: 'center', paddingVertical: 8 },
  tokenCard: { gap: 14, padding: 18, borderRadius: 20, backgroundColor: colors.surface },
  tokenTopline: { gap: 4 },
  tokenLabel: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  expiry: { color: colors.secondaryLabel, fontSize: 12 },
  token: { padding: 13, borderRadius: 12, color: colors.label, backgroundColor: colors.background, fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
  actions: { gap: 10 },
});
