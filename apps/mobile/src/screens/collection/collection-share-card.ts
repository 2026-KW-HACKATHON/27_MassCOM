import type { MedalKind, MedalTier } from '@/gamification/badge-api';
import { medalCopy, showcaseRecordNote, tierName, type ShareVariant } from '@/gamification/badge-rules';

// "인스타에 자랑하기" 도감 카드(Issue #332)가 그릴 값만 모은 모델. 이 카드는 SNS에 그대로 올라가므로, 도감 응답에서
// 계정·별명·이메일·날짜·지갑·QR·친구 코드는 어떤 것도 가져오지 않고 화면에 그릴 문구·그림·등급만 뽑는다
// (collection-share-card.test.ts가 그런 값이 실린 응답으로 JSON 전체를 검사한다).

export const collectionShareCardTitle = '나의 월계 도감';
export const collectionShareCardFooter = 'MassCOM · 월계 동네 수집';
/** 한 장에 담는 수집품 수: 3×2 격자. */
export const collectionShareCardSlots = 6;
/** 피드에서 잘리지 않는 4:5. 화면에 그리는 크기(dp)와, 공유 이미지로 찍는 크기(px)는 비율이 같다. */
export const collectionShareCardSize = { width: 360, height: 450 } as const;
export const collectionShareCaptureSize = { width: 1080, height: 1350 } as const;

export type ShareCardGrade = 'BRONZE' | 'SILVER' | 'GOLD';

export type CollectionShareCardInput = {
  visits: readonly { merchantId: string }[];
  collectibles: readonly {
    entitlementId: string;
    merchantId: string;
    merchantName: string;
    displayName: string;
    targetVisitCount: 1 | 3 | 5;
    earnedAt: string;
    /** 없으면 아직 그림이 없는 예전 수집품이다. */
    artwork?: { publicationId: string; gradeId: string; name: string; thumbnailDataUrl: string };
  }[];
  medals: readonly { kind: MedalKind; tier: MedalTier }[];
};

export type CollectionShareCardItem = {
  title: string;
  storeName: string;
  grade: ShareCardGrade;
  /** 그림이 없는 예전 수집품은 null이고, 카드가 이름만 있는 틀로 그린다. */
  imageUri: string | null;
};

export type CollectionShareCardMedal = { kind: MedalKind; label: string; tier: MedalTier; tierLabel: string };

export type CollectionShareCardModel = {
  title: string;
  subtitle: string;
  footer: string;
  visitedStoreCount: number;
  items: readonly CollectionShareCardItem[];
  medals: readonly CollectionShareCardMedal[];
  /** 시연 앱에서만 "체험용 가상 기록"을 붙인다(배지 공유 카드와 같은 규칙). */
  demoNote: string | null;
};

const medalKindOrder: readonly MedalKind[] = ['explorer', 'regular', 'steady'];

const gradeByGoal: Record<1 | 3 | 5, ShareCardGrade> = { 1: 'BRONZE', 3: 'SILVER', 5: 'GOLD' };
const gradeRank: Record<ShareCardGrade, number> = { BRONZE: 0, SILVER: 1, GOLD: 2 };

/**
 * 대표 수집품은 등급이 높은 것부터, 같은 등급이면 최근에 받은 것부터 최대 6장이다. 같은 게시 그림을 여러 번 받았으면
 * (도감의 묶음 규칙과 같은 기준) 가장 앞선 한 장만 보인다. 등급은 보상 목표(1·3·5회) 그대로 브론즈·실버·골드다.
 */
export function buildCollectionShareCard(input: CollectionShareCardInput, variant: ShareVariant = 'production'): CollectionShareCardModel {
  const storeIds = new Set([...input.visits.map((visit) => visit.merchantId), ...input.collectibles.map((item) => item.merchantId)]);
  const ranked = [...input.collectibles].sort((a, b) =>
    gradeRank[gradeByGoal[b.targetVisitCount]] - gradeRank[gradeByGoal[a.targetVisitCount]]
    || (a.earnedAt < b.earnedAt ? 1 : a.earnedAt > b.earnedAt ? -1 : 0)
    || (a.entitlementId < b.entitlementId ? -1 : 1));

  const seenPictures = new Set<string>();
  const items: CollectionShareCardItem[] = [];
  for (const item of ranked) {
    if (items.length >= collectionShareCardSlots) break;
    if (item.artwork) {
      const pictureKey = `${item.artwork.publicationId}:${item.artwork.gradeId}`;
      if (seenPictures.has(pictureKey)) continue;
      seenPictures.add(pictureKey);
    }
    items.push({
      title: item.artwork?.name ?? item.displayName,
      storeName: item.merchantName,
      grade: gradeByGoal[item.targetVisitCount],
      imageUri: item.artwork?.thumbnailDataUrl ?? null,
    });
  }

  return {
    title: collectionShareCardTitle,
    subtitle: `${storeIds.size}곳의 가게를 모았어요`,
    footer: collectionShareCardFooter,
    visitedStoreCount: storeIds.size,
    items,
    medals: medalKindOrder.flatMap((kind) => {
      const tier = input.medals.find((medal) => medal.kind === kind)?.tier ?? 0;
      return tier > 0 ? [{ kind, label: medalCopy(kind).name, tier, tierLabel: tierName(tier) }] : [];
    }),
    demoNote: variant === 'showcase' ? showcaseRecordNote : null,
  };
}
