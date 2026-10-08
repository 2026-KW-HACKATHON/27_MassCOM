import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { CoinCollectionScreen } from '../../../../apps/mobile/src/screens/coin-collection';
import type { CoinCollection } from '../../../../apps/mobile/src/shop/coin-api';
import type { ExperienceSnapshot } from '../../../../apps/mobile/src/experience/experience-api';

const apiUrl = 'https://masscom-fixture.invalid';
const merchantId = 'qa-store-a';
const source = { sourceKind: 'VISIT', sourceId: 'qa-visit-1', publicationId: 'qa-publication-a', gradeId: 'bronze',
  merchantId, nftStatus: 'NOT_REQUESTED', rerollEligible: false } as const;

const populated: CoinCollection = {
  coins: [{ publicationId: source.publicationId, gradeId: source.gradeId, name: '달빛 동전', summary: {},
    quantity: 1, visitQuantity: 1, drawQuantity: 0, rerollQuantity: 0 }],
  catalog: [
    { merchantId, merchantName: 'QA 달빛 식당', types: [{ publicationId: source.publicationId, name: '달빛 시리즈', grades: [
      { publicationId: source.publicationId, gradeId: 'bronze', name: '달빛 동전', summary: {}, quantity: 1, sources: [source] },
      { publicationId: source.publicationId, gradeId: 'prism', name: '달빛 프리즘', summary: {}, quantity: 0, sources: [] },
    ] }] },
    { merchantId: 'qa-store-b', merchantName: 'QA 별빛 카페', types: [{ publicationId: 'qa-publication-b', name: '별빛 시리즈', grades: [
      { publicationId: 'qa-publication-b', gradeId: 'silver', name: '별빛 동전', summary: {}, quantity: 0, sources: [] },
    ] }] },
  ],
  series: [{ id: 'qa-series-a', title: '달빛 코인 모음', merchantId, merchantName: 'QA 달빛 식당',
    endsAt: '2099-12-31T00:00:00Z', claimable: null, coupon: null,
    base: { title: '기본 모음', detail: 'QA 진행도 확인', complete: false, slots: [
      { publicationId: source.publicationId, gradeId: 'bronze', name: '달빛 동전', quantity: 1 },
      { publicationId: source.publicationId, gradeId: 'prism', name: '달빛 프리즘', quantity: 0 },
    ] },
    prism: { title: '프리즘 모음', detail: 'QA 미보유 상태 확인', complete: false, slots: [
      { publicationId: source.publicationId, gradeId: 'prism', name: '달빛 프리즘', quantity: 0 },
    ] } }],
  reroll: { tickets: [], sources: [source], options: [] },
};

const empty: CoinCollection = { coins: [], catalog: [], series: [], reroll: { tickets: [], sources: [], options: [] } };

const experience: ExperienceSnapshot = {
  catalog: { badges: [], cosmetics: [], packs: [] },
  profile: { badgeId: null, cosmetics: { hat: null, bag: null, prop: null, pose: null, decor: null },
    coinEntitlementId: null, coinSource: null, wishlist: null },
  progress: { badges: [], cosmetics: [], packs: [] },
};

const credential = { kind: 'bearer', sessionToken: 'synthetic-qa-only' } as const;
const onSessionInvalid = async () => undefined;

export function CollectionScenario() {
  const [ready, setReady] = useState(false);
  const isEmpty = new URLSearchParams(window.location.search).get('mode') === 'empty';

  useEffect(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(`${apiUrl}/`) || (init?.method && init.method !== 'GET')) {
        throw new Error(`QA fixture blocked request: ${url}`);
      }
      if (url === `${apiUrl}/me/coins`) return Response.json(isEmpty ? empty : populated);
      if (url === `${apiUrl}/me/experience`) return Response.json(experience);
      throw new Error(`QA fixture has no response for ${url}`);
    };
    setReady(true);
    return () => { globalThis.fetch = originalFetch; };
  }, [isEmpty]);

  return <View style={{ flex: 1 }}>
    <Text accessibilityRole="header" style={{ padding: 12, color: '#163D46', fontWeight: '800' }}>
      QA 합성 도감 · 실제 API 연결 없음
    </Text>
    {ready ? <CoinCollectionScreen apiUrl={apiUrl} accountId="qa-account" credential={credential}
      onSessionInvalid={onSessionInvalid} /> : null}
  </View>;
}
