import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { DiscoveryProvider } from '../../../../apps/mobile/src/discovery/discovery-provider';
import { HomeScreen } from '../../../../apps/mobile/src/screens/home';
import { defaultStudio } from '../../../../apps/mobile/src/studio/studio-api';

const apiUrl = 'https://masscom-fixture.invalid';
const credential = { kind: 'bearer', sessionToken: 'synthetic-qa-only' } as const;
const onSessionInvalid = async () => undefined;
const merchantId = 'qa-store-a';
const campaignId = 'qa-campaign-a';
const visit = { visitEventId: 'qa-visit-a', merchantId, merchantName: 'QA 달빛 식당', campaignId,
  campaignTitle: 'QA 방문 목표', businessDate: '2026-10-08', progressCounted: true, verificationLevel: 'MERCHANT_CONFIRMED' };
const merchant = { id: merchantId, name: 'QA 달빛 식당', story: '', roadAddress: 'QA 전용 주소', minimumSpendWon: 0, demo: true,
  campaign: { id: campaignId, title: 'QA 방문 목표', startsAt: '2020-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z',
    enrollmentStatus: 'OPEN', rewardGoals: [1, 3, 5].map((targetVisitCount) => ({ targetVisitCount, displayName: 'QA 보상' })) } };
const reward = { entitlementId: 'qa-reward-a', merchantId, merchantName: merchant.name, campaignId,
  campaignTitle: 'QA 방문 목표', targetVisitCount: 1, displayName: 'QA 방문 수집품', earnedAt: '2026-10-08T00:00:00Z',
  appCollectibleStatus: 'COLLECTED', mintJobId: null, recipient: null, nftStatus: 'NOT_REQUESTED', nft: null };
const coinShop = { mileage: { earned: 0, spent: 0, balance: 0 }, pools: [{ id: 'qa-pool-a', merchantId,
  merchantName: merchant.name, eventName: 'QA 가게 코인', grade: 'BRONZE', price: 0,
  purchaseStartsAt: '2020-01-01T00:00:00Z', purchaseEndsAt: '2099-01-01T00:00:00Z', useExpiresAt: '2099-01-01T00:00:00Z',
  perAccountLimit: 1, issuanceCap: 1, issuedCount: 1, status: 'ACTIVE', entries: [{ publicationId: 'qa-publication-a',
    gradeId: 'bronze', name: 'QA 달빛 코인', weight: 1, probability: 1, summary: {} }] }], tickets: [{ id: 'qa-ticket-a',
  poolId: 'qa-pool-a', merchantId, eventName: 'QA 가게 코인', grade: 'BRONZE', acquiredAt: '2026-10-08T00:00:00Z',
  expiresAt: '2099-01-01T00:00:00Z', status: 'UNUSED' }] };

type Mode = 'first' | 'reward' | 'coin' | 'progress' | 'loading' | 'error';

/** Production HomeScreen with synthetic read-only answers; every external request is blocked. */
export function HomeScenario() {
  const [ready, setReady] = useState(false);
  const requested = new URLSearchParams(window.location.search).get('mode');
  const mode: Mode = requested === 'reward' || requested === 'coin' || requested === 'progress' || requested === 'loading' || requested === 'error'
    ? requested : 'first';

  useEffect(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(`${apiUrl}/`) || (init?.method && init.method !== 'GET')) throw new Error(`QA fixture blocked request: ${url}`);
      const path = url.slice(apiUrl.length);
      if (path === '/me/store-tickets' && mode === 'loading') return new Promise<Response>(() => undefined);
      if (path === '/me/store-tickets' && mode === 'error') throw new Error('QA reward lookup failure');
      if (path === '/me/store-tickets') return Response.json({ tickets: mode === 'reward' ? [reward] : [] });
      if (path === '/collection') return Response.json({ visits: mode === 'progress' ? [visit] : [], collectibles: [] });
      if (path === '/coin-shop') return Response.json({ ...coinShop, tickets: mode === 'coin' ? coinShop.tickets : [] });
      if (path === '/merchants') return Response.json({ merchants: [merchant] });
      if (path === '/recommendations') return Response.json({ recommendations: [] });
      if (path === '/me/studio') return Response.json({ studio: defaultStudio,
        items: [], coinItems: [], furnitureItems: [], avatar: null, records: [], unlockedThemes: [] });
      throw new Error(`QA fixture has no response for ${url}`);
    };
    setReady(true);
    return () => { globalThis.fetch = originalFetch; };
  }, [mode]);

  return <View style={{ flex: 1 }}>
    <Text accessibilityRole="header" style={{ padding: 12, color: '#163D46', fontWeight: '800' }}>
      QA 합성 홈 · 실제 API 연결 없음 · {mode}
    </Text>
    {ready ? <DiscoveryProvider apiUrl={apiUrl} accountId="qa-account" credential={credential} onSessionInvalid={onSessionInvalid}>
      <HomeScreen apiUrl={apiUrl} accountId="qa-account" credential={credential} onSessionInvalid={onSessionInvalid} />
    </DiscoveryProvider> : null}
  </View>;
}
