import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';
import { colors } from '@/theme/colors';

export function CollectionScreen({ apiUrl, accountId }: { apiUrl: string; accountId: string }) {
  const api = useMemo(() => createCommerceApiClient({ apiUrl, accountId }), [accountId, apiUrl]);
  const [collection, setCollection] = useState<CollectionSnapshot>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void api
      .getCollection()
      .then((next) => {
        if (active) setCollection(next);
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
  }, [api]);

  async function refresh() {
    setRefreshing(true);
    setError(undefined);
    try {
      setCollection(await api.getCollection());
    } catch {
      setError('최신 도감을 가져오지 못했습니다. 기존 내용은 유지합니다.');
    } finally {
      setRefreshing(false);
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
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>나의 월계 기록</Text>
        <Text selectable style={styles.title}>방문과 수집품을{`\n`}서로 다른 상태로 봅니다.</Text>
        <View style={styles.countRow}>
          <Count label="방문" value={collection.visits.length} />
          <Count label="앱 수집품" value={collection.collectibles.length} />
          <Count label="실제 NFT" value={collection.collectibles.filter((item) => item.nftStatus === 'FULFILLED').length} />
        </View>
      </View>

      {error ? <Text style={styles.inlineError}>{error}</Text> : null}

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
  if (status === 'REQUESTED') return '발행 요청됨';
  if (status === 'FULFILLED') return '발행 완료';
  return '발행하지 않음';
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
  visitRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, padding: 16, borderRadius: 18, backgroundColor: colors.surface },
  visitMerchant: { color: colors.label, fontSize: 16, fontWeight: '900' },
  visitRight: { alignItems: 'flex-end', gap: 3 },
  visitDate: { color: colors.label, fontSize: 13, fontWeight: '800' },
  progressLabel: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  emptyCopy: { padding: 18, borderRadius: 18, color: colors.secondaryLabel, backgroundColor: colors.surface, fontSize: 14, lineHeight: 22 },
});
