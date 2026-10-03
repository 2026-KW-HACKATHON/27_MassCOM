import { getAppPackageId } from '@/config/app-identity';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Link, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme, useWindowDimensions } from 'react-native';

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
import { acceptInspection, redeemTarget } from '@/commerce/claim-inspect';
import { createIdentityRequestGate, customerIdentityCode, isCustomerIdentityExpired } from '@/commerce/customer-identity';
import {
  claimFailureAction,
  claimSuccessCopy,
  type ClaimRecoveryAction,
} from '@/commerce/claim-recovery';
import { createBadgeApiClient, type BadgeBook } from '@/gamification/badge-api';
import { diffBadgeBooks } from '@/gamification/badge-rules';
import { progressNote } from '@/commerce/progress-note';
import { defaultVisitGoals, mileageBalanceLine, mileageDeltaLine, settleWithin, visitRewardGuide } from '@/commerce/visit-reward-guide';
import { playUiSound } from '@/sound/ui-sounds';
import { Celebration, type CelebrationContent } from '@/gamification/celebration';
import { createMerchantApiClient, type PublicMerchant } from '@/merchant/merchant-api';
import { canShowTestVisitSection } from '@/navigation/showcase-entry';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { createShopApiClient, type ShopApiClient } from '@/shop/shop-api';
import { colorsForScheme, type AppColors } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { AppHeader } from '@/ui/app-header';
import { canUseCamera } from '@/ui/can-use-camera';
import { FloatingCard } from '@/ui/floating-card';
import { heroMascotSize } from '@/ui/large-text';
import { Mascot } from '@/ui/mascot';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { Stagger } from '@/ui/stagger';

import { makeClaimRedeemStyles } from './styles';

/** 방문 수령 전·후의 적립 합계(`mileage.earned`). 못 읽으면 undefined라 그 방문은 "+N 적립" 줄만 빠진다. */
function readEarnedMileage(client: ShopApiClient): Promise<number | undefined> {
  return client.getShop().then((shop) => shop.mileage.earned, () => undefined);
}

/** 방문 전 적립 합계를 이만큼만 기다린다: 상점 요약이 멈춰 있어도 방문 수령을 붙잡지 않는다. */
const mileageSnapshotWaitMs = 1500;

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
  const { fontScale } = useWindowDimensions();
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const styles = StyleSheet.create(makeClaimRedeemStyles(palette, worldForScheme(scheme), StyleSheet.hairlineWidth));
  const api = useMemo(
    () => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  // #332: 상점 요약은 덤이라 세션 만료 처리(onSessionInvalid)를 넘기지 않는다. 못 읽으면 조용히 그 줄만 빠진다.
  const shopApi = useMemo(
    () => createShopApiClient({ apiUrl, credential }),
    [apiUrl, credential],
  );
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<ClaimPreview>();
  const [redeemed, setRedeemed] = useState<RedeemedClaim>();
  // 이 방문 수령으로 받은 보상 중 다시 볼 수 있는 가게 수집품(외형)이 실제로 붙은 것 전부(1·3·5회 목표가 한 번에 여럿이면 모두).
  // 도감을 확인한 뒤에만 채운다.
  const [artworkReward, setArtworkReward] = useState<{ claimSlotId: string; entitlementIds: readonly string[] }>();
  // #332 방문 완료 카드의 "+N 마일리지 적립"(방문 전·후 적립 합계의 차이)과 "보유 N마일리지"(방문 뒤 상점 요약). 방문(claimSlotId)에
  // 묶어 두고, 늦게 온 이전 방문의 응답이 새 방문의 안내를 덮지 못하게 요청 번호로 거른다.
  const [rewardContext, setRewardContext] = useState<{ claimSlotId: string; mileageLine: string | null; balance: number | null }>();
  const rewardContextRequest = useRef(0);
  // 코드를 확인할 때의 적립 합계. badgesBeforeClaim과 같은 방식으로 방문 수령 직전까지 쥐고 있다가 방문 뒤 값과 비교한다.
  const mileageBeforeClaim = useRef<Promise<number | undefined> | undefined>(undefined);
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
  // 코드 확인 응답이 입력이 바뀐 뒤에 도착해도 이전 코드의 미리보기가 덮어쓰지 못하게 한다.
  const inspectGate = useRef(createIdentityRequestGate()).current;
  const router = useRouter();
  const badgeApi = useMemo(
    () => createBadgeApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  // Badge book seen when the code was checked; compared after the claim for the celebration.
  const badgesBeforeClaim = useRef<Promise<BadgeBook | undefined> | undefined>(undefined);
  const [celebration, setCelebration] = useState<CelebrationContent>();

  // #295 "테스트 방문 만들기": 시연 앱과 로컬 개발 빌드에만 보인다. 운영 패키지는 섹션 자체가 없다.
  const showTestVisitSection = canShowTestVisitSection(getAppPackageId());
  const [testVisitMerchants, setTestVisitMerchants] = useState<readonly PublicMerchant[]>([]);
  const [selectedTestVisitMerchantId, setSelectedTestVisitMerchantId] = useState<string>();
  const [testVisitBusy, setTestVisitBusy] = useState(false);
  const [testVisitMessage, setTestVisitMessage] = useState<string>();

  useEffect(() => {
    if (!showTestVisitSection) return;
    let active = true;
    void createMerchantApiClient(apiUrl).listMerchants()
      .then((merchants) => {
        if (!active) return;
        const demo = merchants.filter((merchant) => merchant.demo);
        setTestVisitMerchants(demo);
        setSelectedTestVisitMerchantId((current) => current ?? demo[0]?.id);
      })
      .catch(() => {
        if (active) setTestVisitMessage('가상 점포 목록을 불러오지 못했습니다.');
      });
    return () => { active = false; };
  }, [apiUrl, showTestVisitSection]);

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
    inspectGate.cancel();
    badgesBeforeClaim.current = undefined;
    setToken(value);
    setPreview(undefined);
    setRedeemed(undefined);
    setArtworkReward(undefined);
    rewardContextRequest.current += 1;
    mileageBeforeClaim.current = undefined;
    setRewardContext(undefined);
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
    const request = inspectGate.start();
    setBusy(true);
    setMessage(undefined);
    try {
      const next = await api.previewClaim(code);
      const accepted = acceptInspection(inspectGate.isCurrent(request), code, next);
      if (!accepted) return;
      badgesBeforeClaim.current = next.status === 'AVAILABLE'
        ? badgeApi.getBadgeBook().catch(() => undefined)
        : undefined;
      mileageBeforeClaim.current = next.status === 'AVAILABLE' ? readEarnedMileage(shopApi) : undefined;
      setPreview(accepted.preview);
      setPendingRedeemToken(accepted.pendingRedeemToken);
      setRecoveryAction(undefined);
      setMessage(accepted.message);
      requestAnimationFrame(() => scrollView.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      if (inspectGate.isCurrent(request)) {
        playUiSound('error');
        setMessage(messageFor(error));
      }
    } finally {
      // 한 번에 한 작업만 두므로, 버려진 응답이어도 처리 중 표시는 항상 푼다.
      setBusy(false);
    }
  }

  async function redeem() {
    // 지금 입력칸의 코드로 확인한 미리보기일 때만 확정한다.
    const target = redeemTarget(token, pendingRedeemToken, preview);
    if (!target || !preview || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      // 방문이 먼저 반영된 뒤의 값을 "이전"으로 읽지 않도록, 요청을 보내기 전에 스냅샷이 끝났는지(또는 시간 안에 못 끝냈는지) 확인한다.
      const mileageBefore = await settleWithin(mileageBeforeClaim.current, mileageSnapshotWaitMs);
      mileageBeforeClaim.current = undefined;
      const result = await api.redeemClaim(target);
      if (!result.replayed) playUiSound('success');
      setRedeemed(result);
      setArtworkReward(undefined);
      void findGrantedArtwork(result);
      void loadRewardContext(result, mileageBefore);
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
      playUiSound('error');
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

  // #295: 실제 QR 없이 가상 점포 방문을 만들고 바로 확정한다. 성공 경로는 일반 redeem()과 같다(setRedeemed/celebrate 재사용).
  async function createTestVisit() {
    if (!selectedTestVisitMerchantId || testVisitBusy) return;
    setTestVisitBusy(true);
    setTestVisitMessage(undefined);
    const before = badgeApi.getBadgeBook().catch(() => undefined);
    try {
      const mileageBefore = await settleWithin(readEarnedMileage(shopApi), mileageSnapshotWaitMs);
      const result = await api.createTestVisit(selectedTestVisitMerchantId);
      setRedeemed(result);
      setArtworkReward(undefined);
      void findGrantedArtwork(result);
      void loadRewardContext(result, mileageBefore);
      setPreview(undefined);
      setToken('');
      setPendingRedeemToken(undefined);
      setRecoveryAction(undefined);
      setMessage(claimSuccessCopy(result).body);
      requestAnimationFrame(() => scrollView.current?.scrollToEnd({ animated: true }));
      void celebrate(result, before);
    } catch (error) {
      setTestVisitMessage(messageFor(error));
    } finally {
      setTestVisitBusy(false);
    }
  }

  // 방문 수령 응답에는 수집품 외형 정보가 없다. 받은 보상 중 도감에서 외형을 가진 것이 있어야 "받은 수집품 보기"를 보인다.
  // 1·3·5회 목표가 한 번에 여럿 달성되면 외형이 붙은 보상 전부를 모아 봉투 연출에 넘긴다(목표 순서대로).
  // 조회가 실패하거나 외형 없는 기존 보상뿐이면 버튼만 생략하고 방문 수령 결과는 그대로다.
  async function findGrantedArtwork(result: RedeemedClaim) {
    if (result.grantedRewards.length === 0) return;
    try {
      const snapshot = await api.getCollection();
      const withArtwork = new Set(snapshot.collectibles.filter((item) => item.artwork).map((item) => item.entitlementId));
      const entitlementIds = [...result.grantedRewards]
        .sort((a, b) => a.targetVisitCount - b.targetVisitCount)
        .map((reward) => reward.entitlementId)
        .filter((entitlementId) => withArtwork.has(entitlementId));
      if (entitlementIds.length > 0) setArtworkReward({ claimSlotId: result.claimSlotId, entitlementIds });
    } catch {
      // 도감 조회 실패는 수집품 버튼을 숨길 뿐이다.
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
      ...(result.visit.progressExcludedReason ? { progressExcludedReason: result.visit.progressExcludedReason } : {}),
      diff: diffBadgeBooks(previous, after),
      after,
    });
  }

  // #332: 방문 뒤 상점 요약을 읽어 이번 방문으로 늘어난 적립 합계(전·후 차이)와 보유 마일리지를 방문 완료 카드에 붙인다. 적립 규칙은
  // 따라 계산하지 않고 서버가 센 합계의 차이만 쓰므로, 전·후 값 중 하나라도 없으면 "+N 적립" 줄이 빠지고(추측하지 않는다) 상점
  // 요약을 못 읽으면 보유 줄도 빠진다. 방문 수령 결과와 카드는 어떤 경우에도 그대로다(조용히 실패).
  async function loadRewardContext(result: RedeemedClaim, earnedBefore: number | undefined) {
    const request = ++rewardContextRequest.current;
    const shop = await shopApi.getShop().then((value) => value, () => undefined);
    if (request !== rewardContextRequest.current) return;
    setRewardContext({
      claimSlotId: result.claimSlotId,
      mileageLine: mileageDeltaLine({ replayed: result.replayed, before: earnedBefore, after: shop?.mileage.earned }),
      balance: shop ? shop.mileage.balance : null,
    });
  }

  const currentRewardContext = redeemed && rewardContext?.claimSlotId === redeemed.claimSlotId ? rewardContext : undefined;
  const rewardBalance = currentRewardContext?.balance ?? null;
  const rewardGuide = redeemed
    ? visitRewardGuide({ progressCount: redeemed.visit.progressVisitCount, goals: defaultVisitGoals })
    : undefined;

  return (
    <>
      <SkyScrollView
        ref={scrollView}
        keyboardShouldPersistTaps="handled"
        header={
          <AppHeader title="방문 인증" subtitle="가게에서 도장을 받아요">
            <View style={styles.hero}>
              {/* Decorative: it still wiggles for a tap, but adds no stop for screen readers. */}
              <Mascot interactive pose="stamp" size={heroMascotSize(fontScale, 112)} />
              <View style={styles.heroBubble}>
                <Text selectable style={styles.heroBubbleText}>직원에게 내 QR을 보여주거나, 점주 코드를 입력해요</Text>
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
          {canUseCamera && scanning ? (
            <View style={styles.camera}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => handleScanned(data)}
              />
            </View>
          ) : null}
          {canUseCamera ? (
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
          ) : null}
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

        {showTestVisitSection ? (
          <Stagger index={3}>
          <FloatingCard style={styles.formCard}>
            <Text style={styles.sectionTitle}>테스트 방문 만들기</Text>
            <Text selectable style={styles.securityNote}>실제 QR 없이 가상 점포 방문을 기록합니다. 진행도는 하루 한 번만 올라요.</Text>
            <View style={styles.testVisitChipRow}>
              {testVisitMerchants.map((merchant) => {
                const selected = merchant.id === selectedTestVisitMerchantId;
                return (
                  <Pressable
                    key={merchant.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setSelectedTestVisitMerchantId(merchant.id)}
                    style={[styles.testVisitChip, selected && styles.testVisitChipSelected]}
                  >
                    <Text style={[styles.testVisitChipText, selected && styles.testVisitChipTextSelected]}>{merchant.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            {testVisitMessage ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: palette.onPrimaryContainer, backgroundColor: palette.primaryContainer }]}>{testVisitMessage}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={!selectedTestVisitMerchantId || testVisitBusy}
              onPress={() => void createTestVisit()}
              style={[styles.button, { backgroundColor: !selectedTestVisitMerchantId || testVisitBusy ? palette.primaryContainer : palette.primary }]}
            >
              <Text style={[styles.buttonText, { color: !selectedTestVisitMerchantId || testVisitBusy ? palette.onPrimaryContainer : palette.onPrimary }]}>
                {testVisitBusy ? '만드는 중…' : '테스트 방문 만들기'}
              </Text>
            </Pressable>
          </FloatingCard>
          </Stagger>
        ) : null}

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
              {progressNote(redeemed.visit)}
            </Text>
            <Text style={[styles.successBody, { color: palette.onSuccessContainer }]}>
              새 보상권 {redeemed.grantedRewards.length}개 · NFT 발행은 아직 요청하지 않았습니다.
            </Text>
            {currentRewardContext?.mileageLine ? <Text style={styles.successHighlight}>{currentRewardContext.mileageLine}</Text> : null}
            {rewardBalance !== null ? <Text style={styles.successBody}>{mileageBalanceLine(rewardBalance)}</Text> : null}
            {rewardGuide?.nextGradeLine ? <Text style={styles.successBody}>{rewardGuide.nextGradeLine}</Text> : null}
            <View style={styles.successActions}>
              {artworkReward?.claimSlotId === redeemed.claimSlotId ? (
                <Pressable accessibilityRole="button" onPress={() => router.navigate({ pathname: '/collection', params: { focus: 'collectible', entitlement: artworkReward.entitlementIds.join(',') } })}
                  style={[styles.collectionButton, { backgroundColor: palette.primary }]}>
                  <Text style={[styles.collectionButtonText, { color: palette.onPrimary }]}>받은 수집품 보기</Text>
                </Pressable>
              ) : null}
              {claimSuccessCopy(redeemed).destinations.map((destination) => (
                <Link key={destination.href} href={destination.href} asChild>
                  <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.collectionButton, { backgroundColor: palette.primary }])}>
                    <Text style={[styles.collectionButtonText, { color: palette.onPrimary }]}>{destination.label}</Text>
                  </Pressable>
                </Link>
              ))}
              <Pressable accessibilityRole="button" onPress={() => router.navigate('/shop')}
                style={[styles.collectionButton, { backgroundColor: palette.primary }]}>
                <Text style={[styles.collectionButtonText, { color: palette.onPrimary }]}>상점에서 뽑기</Text>
              </Pressable>
            </View>
          </FloatingCard>
          </View>
          </Stagger>
        ) : null}
      </SkyScrollView>
      <Celebration
        content={celebration}
        variant={getAppPackageId() === 'kr.masscom.wolgye.demo' ? 'showcase' : 'production'}
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
      // #295 테스트 방문 만들기 전용 코드.
      SHOWCASE_MERCHANT_NOT_FOUND: '가상 점포를 찾을 수 없습니다.',
      CLAIM_MERCHANT_INACTIVE: '지금은 쉬고 있는 점포입니다.',
      SHOWCASE_TEST_VISIT_RATE_LIMITED: '테스트 방문을 너무 많이 만들었어요. 잠시 후 다시 시도해 주세요.',
      ACCOUNT_DELETED: '계정이 삭제 처리 중입니다.',
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
