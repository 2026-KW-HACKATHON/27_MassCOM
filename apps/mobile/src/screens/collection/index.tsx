import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommerceApiError, createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';
import { createDemoCredential } from '@/config/demo-runtime';
import { colors } from '@/theme/colors';
import { WalletApiClient, type ActiveWalletBindingResponse } from '@/wallet/wallet-api';

export function CollectionScreen({ apiUrl, accountId }: { apiUrl: string; accountId: string }) {
  const insets = useSafeAreaInsets();
  const credential = useMemo(() => createDemoCredential(accountId), [accountId]);
  const api = useMemo(() => createCommerceApiClient({ apiUrl, credential }), [apiUrl, credential]);
  const walletApi = useMemo(() => new WalletApiClient({ apiUrl, credential }), [apiUrl, credential]);
  const [collection, setCollection] = useState<CollectionSnapshot>();
  const [binding, setBinding] = useState<ActiveWalletBindingResponse['binding']>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyEntitlementId, setBusyEntitlementId] = useState<string>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.all([api.getCollection(), walletApi.getActiveBinding()])
      .then(([nextCollection, nextBinding]) => {
        if (active) {
          setCollection(nextCollection);
          setBinding(nextBinding.binding);
        }
      })
      .catch(() => {
        if (active) setError('도감을 불러오지 못했습니다. API 연결을 확인해 주세요.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, walletApi]);

  useEffect(() => {
    if (!collection?.collectibles.some((item) => item.nftStatus === 'QUEUED' || item.nftStatus === 'CONFIRMING')) {
      return;
    }
    const timer = setInterval(() => {
      void api
        .getCollection()
        .then((next) => {
          const finalized = next.collectibles.some(
            (item) =>
              item.nftStatus === 'FINALIZED' &&
              collection.collectibles.some(
                (previous) =>
                  previous.entitlementId === item.entitlementId &&
                  (previous.nftStatus === 'QUEUED' || previous.nftStatus === 'CONFIRMING'),
              ),
          );
          setCollection(next);
          if (finalized) setMessage('NFT가 블록체인 이벤트 대조를 거쳐 등록 완료됐습니다.');
        })
        .catch(() => undefined);
    }, 3_000);
    return () => clearInterval(timer);
  }, [api, collection]);

  async function refresh() {
    setRefreshing(true);
    setError(undefined);
    try {
      const [nextCollection, nextBinding] = await Promise.all([
        api.getCollection(),
        walletApi.getActiveBinding(),
      ]);
      setCollection(nextCollection);
      setBinding(nextBinding.binding);
    } catch {
      setError('최신 도감을 가져오지 못했습니다. 기존 내용은 유지합니다.');
    } finally {
      setRefreshing(false);
    }
  }

  function confirmMint(item: CollectionSnapshot['collectibles'][number]) {
    if (!binding) return;
    Alert.alert(
      '양도 제한 NFT 접수',
      `받을 주소\n${binding.address}\n\n체인 ${chainLabel(binding.chainId)}\n일반 전송이 제한되며 서비스가 발행 비용을 부담합니다. 공개 장부에는 주소와 NFT 식별 정보가 남습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '주소 확인 후 접수',
          onPress: () => void submitMint(item.entitlementId),
        },
      ],
    );
  }

  async function submitMint(entitlementId: string) {
    if (!binding || busyEntitlementId) return;
    setBusyEntitlementId(entitlementId);
    setError(undefined);
    setMessage(undefined);
    const idempotencyKey =
      `mint-${binding.bindingId}-${binding.bindingVersion}-${entitlementId}`;
    try {
      const result = await api.requestMint({
        entitlementId,
        walletBindingId: binding.bindingId,
        bindingVersion: binding.bindingVersion,
        consentVersion: 'nft-mint-v1',
        idempotencyKey,
      });
      setMessage(
        result.replayed
          ? '이미 접수한 NFT 작업을 다시 불러왔습니다.'
          : 'NFT 발행을 접수했습니다. 아직 블록체인 등록 완료가 아닙니다.',
      );
      setCollection(await api.getCollection());
    } catch (caught) {
      setError(mintErrorMessage(caught));
    } finally {
      setBusyEntitlementId(undefined);
    }
  }

  if (loading && !collection) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.centeredTitle}>방문 도감을 펼치는 중</Text>
      </View>
    );
  }

  if (!collection) {
    return (
      <View style={styles.centered}>
        <Text style={styles.centeredTitle}>도감을 불러오지 못했어요</Text>
        <Text style={styles.centeredBody}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={refresh} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>다시 불러오기</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>나의 월계 기록</Text>
        <Text selectable style={styles.title}>방문과 수집품을{`\n`}서로 다른 상태로 봅니다.</Text>
        <View style={styles.countRow}>
          <Count label="방문" value={collection.visits.length} />
          <Count label="앱 수집품" value={collection.collectibles.length} />
          <Count label="실제 NFT" value={collection.collectibles.filter((item) => item.nftStatus === 'FINALIZED').length} />
        </View>
      </View>

      {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      {message ? <Text style={styles.inlineMessage}>{message}</Text> : null}

      <Section title="앱에서 받은 수집품" note="보상권을 받으면 앱 도감에 먼저 기록됩니다.">
        {collection.collectibles.length === 0 ? (
          <EmptyCopy text="아직 받은 수집품이 없습니다. 첫 방문을 인증해 보세요." />
        ) : (
          collection.collectibles.map((item) => (
            <View key={item.entitlementId} style={styles.collectibleCard}>
              <View style={styles.collectibleTopline}>
                <Text style={styles.goalBadge}>{item.targetVisitCount}회</Text>
                <Text style={styles.appStatus}>APP · 수집 완료</Text>
              </View>
              <Text selectable style={styles.itemTitle}>{item.displayName}</Text>
              <Text style={styles.itemMeta}>{item.merchantName} · {item.campaignTitle}</Text>
              <View style={styles.nftRow}>
                <Text style={styles.nftLabel}>실제 NFT</Text>
                <Text style={styles.nftValue}>{nftLabel(item.nftStatus)}</Text>
              </View>
              {item.recipient ? (
                <Text selectable style={styles.recipient}>수령인 {shortAddress(item.recipient)}</Text>
              ) : null}
              {item.nft ? (
                <Text selectable style={styles.nftIdentity}>
                  {chainLabel(item.nft.chainId)} · {shortAddress(item.nft.contractAddress)} · #{item.nft.tokenId}
                </Text>
              ) : null}
              {item.nftStatus === 'NOT_REQUESTED' ? (
                binding ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busyEntitlementId === item.entitlementId}
                    onPress={() => confirmMint(item)}
                    style={[styles.mintButton, busyEntitlementId === item.entitlementId && styles.disabled]}
                  >
                    <Text style={styles.mintButtonText}>
                      {busyEntitlementId === item.entitlementId ? '접수 중…' : '양도 제한 NFT 받기'}
                    </Text>
                  </Pressable>
                ) : (
                  <Link href="/wallet" asChild>
                    <Pressable accessibilityRole="button" style={styles.walletButton}>
                      <Text style={styles.walletButtonText}>외부 지갑 주소 확인</Text>
                    </Pressable>
                  </Link>
                )
              ) : null}
            </View>
          ))
        )}
      </Section>

      <Section title="방문 기록" note="정확한 식사 시각 대신 한국 날짜만 표시합니다.">
        {collection.visits.length === 0 ? (
          <EmptyCopy text="아직 인증한 방문이 없습니다." />
        ) : (
          collection.visits.map((visit) => (
            <View key={visit.visitEventId} style={styles.visitRow}>
              <View>
                <Text selectable style={styles.visitMerchant}>{visit.merchantName}</Text>
                <Text style={styles.itemMeta}>{visit.campaignTitle}</Text>
              </View>
              <View style={styles.visitRight}>
                <Text style={styles.visitDate}>{visit.businessDate}</Text>
                <Text style={styles.progressLabel}>{visit.progressCounted ? '진행 반영' : '방문만 기록'}</Text>
              </View>
            </View>
          ))
        )}
      </Section>

      <Link href="/recommendations" asChild>
        <Pressable accessibilityRole="button" style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>다음 음식점 추천 보기</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.countItem}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionNote}>{note}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function EmptyCopy({ text }: { text: string }) {
  return <Text style={styles.emptyCopy}>{text}</Text>;
}

function nftLabel(status: CollectionSnapshot['collectibles'][number]['nftStatus']): string {
  if (status === 'QUEUED') return 'NFT 접수';
  if (status === 'CONFIRMING') return '블록체인 확인 중';
  if (status === 'FINALIZED') return '등록 완료';
  if (status === 'REVIEW_REQUIRED') return '확인 필요';
  return '발행하지 않음';
}

function mintErrorMessage(error: unknown): string {
  if (error instanceof CommerceApiError) {
    const messages: Record<string, string> = {
      WALLET_BINDING_CHANGED: '지갑 주소 확인 버전이 바뀌었습니다. 지갑 화면에서 다시 확인해 주세요.',
      WALLET_BINDING_NOT_FOUND: '확인된 외부 지갑 주소가 없습니다.',
      ENTITLEMENT_EXPIRED: 'NFT 신청 기간이 만료됐습니다.',
      MINT_PENDING: '이미 처리 중인 NFT 작업이 있습니다.',
      CAPACITY_UNAVAILABLE: '약속된 발행 수량을 확인할 수 없어 접수를 중지했습니다.',
      CONSENT_REQUIRED: '최신 공개·양도 제한 안내 동의가 필요합니다.',
    };
    return messages[error.code] ?? `NFT 접수 실패: ${error.code}`;
  }
  return 'NFT 접수 중 네트워크 오류가 발생했습니다. 보상권은 유지됩니다.';
}

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function chainLabel(chainId: number): string {
  if (chainId === 84532) return 'Base Sepolia';
  if (chainId === 8453) return 'Base';
  if (chainId === 31337) return 'Local Anvil';
  return `Chain ${chainId}`;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28, backgroundColor: colors.background },
  centeredTitle: { color: colors.label, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  centeredBody: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  primaryButton: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.primary },
  primaryButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '900' },
  content: { gap: 24, padding: 20, paddingBottom: 48, backgroundColor: colors.background },
  hero: { gap: 12, padding: 22, borderRadius: 24, backgroundColor: colors.primaryContainer },
  eyebrow: { color: colors.onPrimaryContainer, fontSize: 12, fontWeight: '900' },
  title: { color: colors.onPrimaryContainer, fontSize: 29, fontWeight: '900', lineHeight: 37, letterSpacing: -0.5 },
  countRow: { flexDirection: 'row', gap: 8 },
  countItem: { flex: 1, gap: 2, padding: 12, borderRadius: 14, backgroundColor: colors.surface },
  countValue: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  countLabel: { color: colors.secondaryLabel, fontSize: 11, fontWeight: '700' },
  inlineError: { padding: 12, borderRadius: 12, color: colors.onErrorContainer, backgroundColor: colors.errorContainer, fontSize: 13 },
  inlineMessage: { padding: 12, borderRadius: 12, color: colors.onPrimaryContainer, backgroundColor: colors.primaryContainer, fontSize: 13, lineHeight: 20 },
  section: { gap: 5 },
  sectionTitle: { color: colors.label, fontSize: 22, fontWeight: '900' },
  sectionNote: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 20 },
  sectionBody: { gap: 12, marginTop: 9 },
  collectibleCard: { gap: 9, padding: 18, borderRadius: 20, backgroundColor: colors.surface },
  collectibleTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalBadge: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  appStatus: { color: colors.onSuccessContainer, fontSize: 11, fontWeight: '900' },
  itemTitle: { color: colors.label, fontSize: 19, fontWeight: '900' },
  itemMeta: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 18 },
  nftRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  nftLabel: { color: colors.secondaryLabel, fontSize: 12, fontWeight: '700' },
  nftValue: { color: colors.label, fontSize: 12, fontWeight: '900' },
  recipient: { color: colors.secondaryLabel, fontFamily: 'monospace', fontSize: 11 },
  nftIdentity: { color: colors.primary, fontFamily: 'monospace', fontSize: 11, lineHeight: 17 },
  mintButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.primary },
  mintButtonText: { color: colors.onPrimary, fontSize: 13, fontWeight: '900' },
  walletButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.primary },
  walletButtonText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.42 },
  visitRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, padding: 16, borderRadius: 18, backgroundColor: colors.surface },
  visitMerchant: { color: colors.label, fontSize: 16, fontWeight: '900' },
  visitRight: { alignItems: 'flex-end', gap: 3 },
  visitDate: { color: colors.label, fontSize: 13, fontWeight: '800' },
  progressLabel: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  emptyCopy: { padding: 18, borderRadius: 18, color: colors.secondaryLabel, backgroundColor: colors.surface, fontSize: 14, lineHeight: 22 },
});
