import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Application from 'expo-application';
import { Link, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';
import {
  CommerceApiError,
  createCommerceApiClient,
  type ClaimPreview,
  type CustomerIdentity,
  type RedeemedClaim,
} from '@/commerce/commerce-api';
import { createScanGate, parseScannedClaimCode } from '@/commerce/claim-code';
import { ClaimQr } from '@/commerce/claim-qr';
import { customerIdentityCode, isCustomerIdentityExpired } from '@/commerce/customer-identity';
import {
  claimFailureAction,
  claimSuccessCopy,
  type ClaimRecoveryAction,
} from '@/commerce/claim-recovery';
import { createBadgeApiClient, type BadgeBook } from '@/gamification/badge-api';
import { diffBadgeBooks } from '@/gamification/badge-rules';
import { Celebration, type CelebrationContent } from '@/gamification/celebration';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { colorsForScheme, type AppColors } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { AppHeader } from '@/ui/app-header';
import { FloatingCard } from '@/ui/floating-card';
import { Mascot } from '@/ui/mascot';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { Stagger } from '@/ui/stagger';

import { makeClaimRedeemStyles } from './styles';

export function ClaimRedeemScreen({
  apiUrl,
  credential,
  onSessionInvalid,
}: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
}) {
  const scrollView = useRef<ScrollView>(null);
  const clearance = useTabBarClearance();
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const styles = StyleSheet.create(makeClaimRedeemStyles(palette, worldForScheme(scheme), StyleSheet.hairlineWidth));
  const api = useMemo(
    () => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<ClaimPreview>();
  const [redeemed, setRedeemed] = useState<RedeemedClaim>();
  const [pendingRedeemToken, setPendingRedeemToken] = useState<string>();
  const [recoveryAction, setRecoveryAction] = useState<ClaimRecoveryAction>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [identity, setIdentity] = useState<CustomerIdentity>();
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityMessage, setIdentityMessage] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [, requestCameraPermission] = useCameraPermissions();
  const scanGate = useRef(createScanGate()).current;
  const router = useRouter();
  const badgeApi = useMemo(
    () => createBadgeApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  // Badge book seen when the code was checked; compared after the claim for the celebration.
  const badgesBeforeClaim = useRef<Promise<BadgeBook | undefined> | undefined>(undefined);
  const [celebration, setCelebration] = useState<CelebrationContent>();

  useEffect(() => {
    if (!identity) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (isCustomerIdentityExpired(identity.expiresAt, current)) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [identity]);

  async function refreshIdentity() {
    if (identityBusy) return;
    setIdentityBusy(true);
    setIdentityMessage(undefined);
    setIdentity(undefined);
    try {
      const next = await api.createCustomerIdentity();
      setIdentity(next);
      setNow(Date.now());
    } catch (error) {
      setIdentityMessage(messageFor(error));
    } finally {
      setIdentityBusy(false);
    }
  }

  async function revokeIdentity() {
    if (!identity || identityBusy) return;
    setIdentityBusy(true);
    setIdentityMessage(undefined);
    setIdentity(undefined);
    try {
      await api.revokeCustomerIdentity(identity.token);
      setIdentityMessage('식별 QR을 폐기했습니다.');
    } catch (error) {
      setIdentityMessage(`${messageFor(error)} 폐기 결과를 확인할 수 없어 이전 QR이 아직 유효할 수 있습니다. 새 QR을 발급해 주세요.`);
    } finally {
      setIdentityBusy(false);
    }
  }

  function changeToken(value: string) {
    badgesBeforeClaim.current = undefined;
    setToken(value);
    setPreview(undefined);
    setRedeemed(undefined);
    setPendingRedeemToken(undefined);
    setRecoveryAction(undefined);
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
      // The camera reports the same wrong QR many times a second; keep the state identical.
      const notClaimQr = '방문 수령용 QR이 아닙니다. 점주 화면의 QR을 다시 비춰 주세요.';
      setMessage((current) => (current === notClaimQr ? current : notClaimQr));
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
      badgesBeforeClaim.current = next.status === 'AVAILABLE'
        ? badgeApi.getBadgeBook().catch(() => undefined)
        : undefined;
      setPreview(next);
      setPendingRedeemToken(code);
      setRecoveryAction(undefined);
      setMessage(next.status === 'AVAILABLE' ? '사용 가능한 1회 코드입니다. 아래에서 수령을 확정하세요.' : '만료된 코드입니다.');
      requestAnimationFrame(() => scrollView.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!pendingRedeemToken || preview?.status !== 'AVAILABLE' || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await api.redeemClaim(pendingRedeemToken);
      setRedeemed(result);
      setPreview(undefined);
      setToken('');
      setPendingRedeemToken(undefined);
      setRecoveryAction(undefined);
      setMessage(claimSuccessCopy(result).body);
      requestAnimationFrame(() => scrollView.current?.scrollToEnd({ animated: true }));
      const before = badgesBeforeClaim.current;
      badgesBeforeClaim.current = undefined;
      if (!result.replayed) void celebrate(result, before);
    } catch (error) {
      const action = claimFailureAction(error, preview);
      setRecoveryAction(action);
      setMessage(action.message);
      if (!action.keepPreview) {
        setPreview(undefined);
        setPendingRedeemToken(undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  // Runs after the claim is final; a badge lookup failure only trims the celebration, never the claim.
  async function celebrate(result: RedeemedClaim, before: Promise<BadgeBook | undefined> | undefined) {
    const [previous, after] = await Promise.all([
      before ?? Promise.resolve(undefined),
      badgeApi.getBadgeBook().catch(() => undefined),
    ]);
    setCelebration({
      merchantName: result.merchantName,
      progressCounted: result.visit.progressCounted,
      diff: diffBadgeBooks(previous, after),
      after,
    });
  }

  return (
    <>
      <SkyScrollView
        ref={scrollView}
        keyboardShouldPersistTaps="handled"
        header={
          <AppHeader title="방문 인증" subtitle="가게에서 도장을 받아요">
            <View style={styles.hero}>
              <Mascot interactive pose="stamp" size={112} accessibilityLabel="도장을 든 마스코트" />
              <View style={styles.heroBubble}>
                <Text selectable style={styles.heroBubbleText}>점주에게 받은 QR을 촬영하거나 1회 코드를 입력하세요.</Text>
              </View>
            </View>
          </AppHeader>
        }
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      >
        <Stagger index={1}>
        <FloatingCard style={styles.formCard}>
          <Text style={styles.sectionTitle}>내 2분 식별 QR</Text>
          <Text selectable style={styles.securityNote}>직원에게 이 QR을 보여주세요. 직원이 식별 후 실제 사용을 확인해야 방문 코드가 발급됩니다.</Text>
          {identity && !isCustomerIdentityExpired(identity.expiresAt, now) ? (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <ClaimQr code={identity.token} accessibilityLabel="직원에게 보여줄 고객 식별 QR 코드" />
              <Text selectable style={styles.sectionTitle}>확인 코드 {customerIdentityCode(identity.token)}</Text>
              <Text style={styles.securityNote}>{Math.ceil((Date.parse(identity.expiresAt) - now) / 1000)}초 뒤 만료</Text>
            </View>
          ) : identity ? <Text accessibilityLiveRegion="polite" style={styles.securityNote}>식별 QR이 만료됐습니다. 새 QR을 발급해 주세요.</Text> : null}
          {identityMessage ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer }]}>{identityMessage}</Text> : null}
          <Pressable accessibilityRole="button" disabled={identityBusy} onPress={() => void refreshIdentity()} style={[styles.button, { backgroundColor: palette.primary }, identityBusy && styles.disabled]}>
            <Text style={[styles.buttonText, { color: palette.onPrimary }]}>{identityBusy ? '처리 중…' : identity ? '새 식별 QR 발급' : '식별 QR 발급'}</Text>
          </Pressable>
          {identity && !isCustomerIdentityExpired(identity.expiresAt, now) ? <Pressable accessibilityRole="button" disabled={identityBusy} onPress={() => void revokeIdentity()} style={[styles.button, { backgroundColor: palette.primaryContainer }, identityBusy && styles.disabled]}>
            <Text style={[styles.buttonText, { color: palette.onPrimaryContainer }]}>이 QR 폐기</Text>
          </Pressable> : null}
        </FloatingCard>
        </Stagger>

        <Stagger index={2}>
        <FloatingCard style={styles.formCard}>
          <Text style={styles.sectionTitle}>1 · 코드 확인</Text>
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
            accessibilityLabel="QR 코드 촬영"
            accessibilityHint="점주 화면의 방문 수령 QR 코드를 카메라로 읽습니다."
            disabled={busy}
            onPress={scanning ? () => setScanning(false) : () => void startScan()}
            style={[styles.button, styles.scanButton, { backgroundColor: palette.surface, borderColor: palette.primary }, busy && styles.disabled]}
          >
            <Text style={[styles.buttonText, styles.scanButtonText, { color: palette.primary }]}>{scanning ? '촬영 닫기' : 'QR 촬영'}</Text>
          </Pressable>
          <Text style={styles.inputLabel}>수령 코드</Text>
          <TextInput
            value={token}
            onChangeText={changeToken}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            placeholder="점주 화면의 1회 코드를 입력"
            placeholderTextColor={palette.secondaryLabel}
            style={styles.input}
          />
          <Text selectable style={styles.securityNote}>코드는 URL이나 로그에 남기지 않고 안전하게 전송합니다.</Text>
          <Pressable accessibilityRole="button" disabled={!token.trim() || busy} onPress={() => void inspect()} style={[styles.button, { backgroundColor: !token.trim() || busy ? palette.primaryContainer : palette.primary }]}>
            <Text style={[styles.buttonText, { color: !token.trim() || busy ? palette.onPrimaryContainer : palette.onPrimary }]}>{busy ? '확인 중…' : '코드 상태 확인'}</Text>
          </Pressable>
        </FloatingCard>
        </Stagger>

        {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer }]}>{message}</Text> : null}

        {preview ? (
          <Stagger index={0}>
          <FloatingCard style={styles.previewCard}>
            <Text style={styles.sectionTitle}>2 · 방문 확정</Text>
            <StatusRow palette={palette} label="상태" value={preview.status === 'AVAILABLE' ? '수령 가능' : '만료'} />
            <StatusRow palette={palette} label="가게" value={preview.merchantName} />
            <StatusRow palette={palette} label="캠페인" value={preview.campaignTitle} />
            <StatusRow palette={palette} label="만료" value={formatDateTime(preview.expiresAt)} />
            {recoveryAction?.kind === 'collection-check' ? (
              <Link href="/collection" asChild>
                <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.button, { backgroundColor: palette.primary }])}>
                  <Text style={[styles.buttonText, { color: palette.onPrimary }]}>{recoveryAction.label}</Text>
                </Pressable>
              </Link>
            ) : (
              <Pressable accessibilityRole="button" disabled={preview.status !== 'AVAILABLE' || busy} onPress={redeem} style={[styles.button, { backgroundColor: preview.status !== 'AVAILABLE' || busy ? palette.primaryContainer : palette.primary }]}>
                <Text style={[styles.buttonText, { color: preview.status !== 'AVAILABLE' || busy ? palette.onPrimaryContainer : palette.onPrimary }]}>
                  {recoveryAction?.kind === 'retry' ? recoveryAction.label : '방문 수령 확정'}
                </Text>
              </Pressable>
            )}
          </FloatingCard>
          </Stagger>
        ) : null}

        {redeemed ? (
          <Stagger index={0}>
          <View accessibilityLiveRegion="polite">
          <FloatingCard style={styles.successCard}>
            <Text style={[styles.successEyebrow, { color: palette.onSuccessContainer }]}>3 · 방문 완료</Text>
            <Text selectable style={[styles.successTitle, { color: palette.onSuccessContainer }]}>{claimSuccessCopy(redeemed).title}</Text>
            <Text selectable style={[styles.successBody, { color: palette.onSuccessContainer }]}>{claimSuccessCopy(redeemed).body}</Text>
            <Text style={[styles.successBody, { color: palette.onSuccessContainer }]}>{redeemed.visit.businessDate} · {redeemed.visit.progressVisitCount}회 진행</Text>
            <Text style={[styles.successBody, { color: palette.onSuccessContainer }]}>
              {redeemed.visit.progressCounted ? '오늘 방문이 진행 횟수에 반영됐습니다.' : '방문은 기록됐지만 같은 한국 날짜의 진행은 한 번만 셉니다.'}
            </Text>
            <Text style={[styles.successBody, { color: palette.onSuccessContainer }]}>
              새 보상권 {redeemed.grantedRewards.length}개 · NFT 발행은 아직 요청하지 않았습니다.
            </Text>
            <View style={styles.successActions}>
              {claimSuccessCopy(redeemed).destinations.map((destination) => (
                <Link key={destination.href} href={destination.href} asChild>
                  <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.collectionButton, { backgroundColor: palette.primary }])}>
                    <Text style={[styles.collectionButtonText, { color: palette.onPrimary }]}>{destination.label}</Text>
                  </Pressable>
                </Link>
              ))}
            </View>
          </FloatingCard>
          </View>
          </Stagger>
        ) : null}
      </SkyScrollView>
      <Celebration
        content={celebration}
        variant={Application.applicationId === 'kr.masscom.wolgye.demo' ? 'showcase' : 'production'}
        onClose={() => setCelebration(undefined)}
        onOpenCollection={(focusRewards) => {
          setCelebration(undefined);
          router.navigate(focusRewards ? { pathname: '/collection', params: { focus: 'rewards' } } : '/collection');
        }}
      />
    </>
  );
}

function StatusRow({ label, value, palette }: { label: string; value: string; palette: AppColors }) {
  const scheme = useColorScheme();
  const styles = StyleSheet.create(makeClaimRedeemStyles(palette, worldForScheme(scheme), StyleSheet.hairlineWidth));
  return (
    <View style={[styles.statusRow, { borderBottomColor: palette.separator }]}>
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
