import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PublishedCollectible } from '@/commerce/collectible-artwork';
import { FullScreenModal } from '@/gamification/full-screen-modal';
import { StateScene } from '@/ui/state-scene';

import { collectibleDetailFailure, type CollectibleDetailFailure } from './collectible-detail-state';
import { EnvelopeReveal, type EnvelopeCardData } from './envelope/envelope-reveal';
import { milestoneForBatch, newEntitlementIds, seriesForBatch, type EnvelopeCollectibleLite } from './envelope/envelope-state';
import type { StoreSeries } from './store-series';

type Props = {
  entitlementIds: readonly string[];
  merchantName: string;
  load: (entitlementId: string) => Promise<PublishedCollectible>;
  /** Account's full collection, lite: decides which of this batch are NEW and whether a distinct-kind milestone was crossed. */
  collectibles: readonly EnvelopeCollectibleLite[];
  /** Already built by the caller (store-series.ts); the one for this batch's merchant backs the end card's progress chips. */
  series: readonly StoreSeries[];
  /** Skips (or finishes) the reveal without opening the full detail. The reward is already stored either way. */
  onSkip: () => void;
  /** Leaves the reveal for the full collectible detail screen, for the first successfully loaded card in the batch. */
  onOpenDetail: (entitlementId: string) => void;
};

/**
 * 297번 "봉투 열기" 연출: 방문 수령으로 한 번에 받은 수집품 전부(1·3·5회 목표가 겹치면 여럿)를 봉투 하나에 담아 연다. 이 화면은
 * entitlementId별 외형을 불러오고 NEW·시리즈 진행·달성 여부를 계산하는 데이터 준비만 맡고, 봉투 열기 연출 자체는
 * envelope/envelope-reveal.tsx가 맡는다(봉투 흔들기·찢기는 reveal-lifecycle.ts의 opening/revealed 패턴을 그대로 쓴다).
 * 언제든 건너뛸 수 있고, 건너뛰어도 보관은 이미 끝난 상태다(이 화면은 저장에 관여하지 않는다).
 */
export function CollectibleReveal({ entitlementIds, merchantName, load, collectibles, series, onSkip, onOpenDetail }: Props) {
  const [cards, setCards] = useState<readonly EnvelopeCardData[]>();
  const [failure, setFailure] = useState<CollectibleDetailFailure>();
  // 도감은 3초마다 조용히 다시 조회돼 `collectibles`가 새 배열로 바뀐다. 그걸 아래 배치 로드 effect의 의존성에 두면, 느린
  // 로드가 끝나기 전에 매번 새로 시작돼 영영 로딩만 반복한다 — 그래서 최신 값은 ref로만 들고, effect는 entitlementIds(이
  // 배치가 무엇인지)가 바뀔 때만 다시 돈다.
  const collectiblesRef = useRef(collectibles);
  useEffect(() => { collectiblesRef.current = collectibles; });

  useEffect(() => {
    let active = true;
    void Promise.allSettled(entitlementIds.map((entitlementId) => load(entitlementId))).then((results) => {
      if (!active) return;
      const isNew = newEntitlementIds(entitlementIds, collectiblesRef.current);
      const loaded: EnvelopeCardData[] = [];
      let firstError: unknown;
      let hadError = false;
      results.forEach((result, index) => {
        const entitlementId = entitlementIds[index]!;
        if (result.status === 'fulfilled') loaded.push({ entitlementId, collectible: result.value, isNew: isNew.has(entitlementId) });
        else { hadError = true; firstError ??= result.reason; }
      });
      // 일부만 실패했으면 불러온 카드만으로 진행한다(보상은 이미 보관됐다); 전부 실패했을 때만 실패 화면을 보인다.
      if (loaded.length === 0 && hadError) setFailure(collectibleDetailFailure(firstError));
      else setCards(loaded);
    });
    return () => { active = false; };
  }, [entitlementIds, load]);

  const milestone = useMemo(() => milestoneForBatch(entitlementIds, collectibles), [entitlementIds, collectibles]);
  const batchSeries = useMemo(() => seriesForBatch(series, collectibles, entitlementIds), [series, collectibles, entitlementIds]);

  return (
    <FullScreenModal visible animationType="fade" onRequestClose={onSkip}>
      {cards ? (
        <EnvelopeReveal cards={cards} merchantName={merchantName} series={batchSeries} milestone={milestone} onSkip={onSkip} onOpenDetail={onOpenDetail} />
      ) : failure ? (
        <View style={styles.loadingFrame}>
          <SkipButton onPress={onSkip} />
          <StateScene kind={failure.removed ? 'empty' : 'error'} title={failure.title} body={failure.body} />
          <Control label="도감으로 돌아가기" onPress={onSkip} />
        </View>
      ) : (
        <View style={styles.loadingFrame}>
          <SkipButton onPress={onSkip} />
          <StateScene kind="loading" title="봉투를 여는 중" />
        </View>
      )}
    </FullScreenModal>
  );
}

/** 건너뛰기는 로딩·실패 상태를 포함해 이 화면의 어느 단계에서도 보여야 한다. */
function SkipButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="연출 건너뛰기" onPress={onPress} style={styles.skipButton}>
      <Text style={styles.skipButtonText}>건너뛰기</Text>
    </Pressable>
  );
}

function Control({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.control}>
      <Text style={styles.controlText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loadingFrame: { flex: 1, alignItems: 'stretch', justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#14213A' },
  skipButton: { alignSelf: 'flex-end', minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  skipButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  control: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  controlText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
