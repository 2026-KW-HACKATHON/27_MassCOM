import { CameraView, useCameraPermissions } from 'expo-camera';
import { Link } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CommerceApiError,
  createCommerceApiClient,
  type ClaimPreview,
  type RedeemedClaim,
} from '@/commerce/commerce-api';
import { createScanGate, parseScannedClaimCode } from '@/commerce/claim-code';
import { colors } from '@/theme/colors';

export function ClaimRedeemScreen({ apiUrl, accountId }: { apiUrl: string; accountId: string }) {
  const scrollView = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const api = useMemo(
    () => createCommerceApiClient({ apiUrl, accountId }),
    [accountId, apiUrl],
  );
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<ClaimPreview>();
  const [redeemed, setRedeemed] = useState<RedeemedClaim>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [, requestCameraPermission] = useCameraPermissions();
  const scanGate = useRef(createScanGate()).current;

  function changeToken(value: string) {
    setToken(value);
    setPreview(undefined);
    setRedeemed(undefined);
    setMessage(undefined);
  }

  async function startScan() {
    const permission = await requestCameraPermission();
    if (!permission.granted) {
      setMessage('카메라 권한이 없어 촬영할 수 없습니다. 점주 화면의 코드를 아래 칸에 직접 입력해 주세요.');
      return;
    }
    scanGate.reset();
    setMessage(undefined);
    setScanning(true);
  }

  // Scanning only fills the code and checks its state; confirming the visit stays a separate tap.
  function handleScanned(raw: string) {
    const scanned = parseScannedClaimCode(raw);
    if (!scanned.ok) {
      setMessage('방문 수령용 QR이 아닙니다. 점주 화면의 QR을 다시 비춰 주세요.');
      return;
    }
    if (!scanGate.accept(scanned.code)) return;
    setScanning(false);
    changeToken(scanned.code);
    void inspect(scanned.code);
  }

  async function inspect(scannedCode?: string) {
    const code = (scannedCode ?? token).trim();
    if (!code || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const next = await api.previewClaim(code);
      setPreview(next);
      setMessage(next.status === 'AVAILABLE' ? '사용 가능한 1회 코드입니다. 아래에서 수령을 확정하세요.' : '만료된 코드입니다.');
      requestAnimationFrame(() => scrollView.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!token.trim() || preview?.status !== 'AVAILABLE' || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await api.redeemClaim(token.trim());
      setRedeemed(result);
      setPreview(undefined);
      setToken('');
      setMessage('방문과 보상권을 서버에서 한 번에 확정했습니다.');
      requestAnimationFrame(() => scrollView.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      ref={scrollView}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom }]}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>방문 인증</Text>
        <Text selectable style={styles.title}>점주가 준 1회 코드를{`\n`}확인하고 받습니다.</Text>
        <Text selectable style={styles.body}>코드는 URL이나 로그에 넣지 않고 서버 POST body로만 전송합니다.</Text>
      </View>

      <View style={styles.formCard}>
        {scanning ? (
          <View style={styles.camera}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => handleScanned(data)}
            />
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={scanning ? () => setScanning(false) : () => void startScan()}
          style={[styles.button, styles.scanButton, busy && styles.disabled]}
        >
          <Text style={[styles.buttonText, styles.scanButtonText]}>{scanning ? '촬영 닫기' : 'QR 촬영'}</Text>
        </Pressable>
        <Text style={styles.inputLabel}>수령 코드</Text>
        <TextInput
          value={token}
          onChangeText={changeToken}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          placeholder="점주 화면의 1회 코드를 입력"
          placeholderTextColor={colors.secondaryLabel}
          style={styles.input}
        />
        <Pressable accessibilityRole="button" disabled={!token.trim() || busy} onPress={() => void inspect()} style={[styles.button, (!token.trim() || busy) && styles.disabled]}>
          <Text style={styles.buttonText}>{busy ? '확인 중…' : '코드 상태 확인'}</Text>
        </Pressable>
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {preview ? (
        <View style={styles.previewCard}>
          <StatusRow label="상태" value={preview.status === 'AVAILABLE' ? '수령 가능' : '만료'} />
          <StatusRow label="점포 ID" value={preview.merchantId} />
          <StatusRow label="만료" value={formatDateTime(preview.expiresAt)} />
          <Pressable accessibilityRole="button" disabled={preview.status !== 'AVAILABLE' || busy} onPress={redeem} style={[styles.button, (preview.status !== 'AVAILABLE' || busy) && styles.disabled]}>
            <Text style={styles.buttonText}>방문 수령 확정</Text>
          </Pressable>
        </View>
      ) : null}

      {redeemed ? (
        <View style={styles.successCard}>
          <Text style={styles.successEyebrow}>방문 인증 완료</Text>
          <Text style={styles.successTitle}>{redeemed.visit.businessDate} · {redeemed.visit.progressVisitCount}회 진행</Text>
          <Text style={styles.successBody}>
            {redeemed.visit.progressCounted ? '오늘 방문이 진행 횟수에 반영됐습니다.' : '방문은 기록됐지만 같은 한국 날짜의 진행은 한 번만 셉니다.'}
          </Text>
          <Text style={styles.successBody}>
            새 보상권 {redeemed.grantedRewards.length}개 · NFT 발행은 아직 요청하지 않았습니다.
          </Text>
          <Link href="/collection" asChild>
            <Pressable accessibilityRole="button" style={styles.collectionButton}>
              <Text style={styles.collectionButtonText}>내 도감 확인</Text>
            </Pressable>
          </Link>
        </View>
      ) : null}
    </ScrollView>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text selectable style={styles.statusValue}>{value}</Text>
    </View>
  );
}

function messageFor(error: unknown): string {
  if (error instanceof CommerceApiError) {
    const messages: Record<string, string> = {
      CLAIM_TOKEN_UNAVAILABLE: '이 계정에서 사용할 수 없거나 이미 사용한 코드입니다.',
      CLAIM_TOKEN_EXPIRED: '코드가 만료됐습니다. 점주에게 재발급을 요청해 주세요.',
      CLAIM_CAMPAIGN_UNAVAILABLE: '현재 수령 가능한 캠페인이 아닙니다. 코드는 소비되지 않았습니다.',
      ACCOUNT_AUTH_NOT_CONFIGURED: 'loopback 개발 계정 모드가 꺼져 있습니다.',
    };
    return messages[error.code] ?? `수령 실패: ${error.code}`;
  }
  return 'API 연결에 실패했습니다. 입력한 코드는 유지됐습니다.';
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
  formCard: { gap: 12, padding: 18, borderRadius: 20, backgroundColor: colors.surface },
  inputLabel: { color: colors.label, fontSize: 14, fontWeight: '900' },
  camera: { height: 280, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000000' },
  scanButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  scanButtonText: { color: colors.primary },
  input: { minHeight: 100, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.separator, color: colors.label, backgroundColor: colors.background, fontFamily: 'monospace', fontSize: 13, textAlignVertical: 'top' },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.primary },
  buttonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '900' },
  disabled: { opacity: 0.42 },
  message: { padding: 13, borderRadius: 14, color: colors.onPrimaryContainer, backgroundColor: colors.primaryContainer, fontSize: 13, lineHeight: 20 },
  previewCard: { gap: 10, padding: 18, borderRadius: 20, backgroundColor: colors.surface },
  statusRow: { flexDirection: 'row', gap: 16, justifyContent: 'space-between', paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  statusLabel: { color: colors.secondaryLabel, fontSize: 13, fontWeight: '700' },
  statusValue: { flex: 1, color: colors.label, fontSize: 13, fontWeight: '800', textAlign: 'right' },
  successCard: { gap: 10, padding: 20, borderRadius: 22, backgroundColor: colors.successContainer },
  successEyebrow: { color: colors.onSuccessContainer, fontSize: 12, fontWeight: '900' },
  successTitle: { color: colors.onSuccessContainer, fontSize: 22, fontWeight: '900' },
  successBody: { color: colors.onSuccessContainer, fontSize: 14, lineHeight: 22 },
  collectionButton: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.primary },
  collectionButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '900' },
});
