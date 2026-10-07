import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';
import { HomeCollectionDisplay } from '@/experience/home-collection-display';
import { useExperience } from '@/experience/use-experience';
import { createMerchantApiClient } from '@/merchant/merchant-api';
import { createShopApiClient } from '@/shop/shop-api';
import { useShop } from '@/shop/use-shop';
import { createStudioApiClient } from '@/studio/studio-api';
import { resolveStudioGoal } from '@/studio/studio-goals';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

export function HomeExhibitScreen({ apiUrl, credential, onSessionInvalid }: {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
}) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const insets = useSafeAreaInsets();
  const experience = useExperience(apiUrl, credential, onSessionInvalid);
  const shopApi = useMemo(() => createShopApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const shop = useShop(shopApi);
  const refreshShop = shop.refreshQuietly;
  const commerceApi = useMemo(() => createCommerceApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const studioApi = useMemo(() => createStudioApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const merchantApi = useMemo(() => createMerchantApiClient(apiUrl), [apiUrl]);
  const [collection, setCollection] = useState<CollectionSnapshot>();
  const [visitGoal, setVisitGoal] = useState<ReturnType<typeof resolveStudioGoal>>();
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (refresh = false, request = ++generation.current) => {
    if (refresh) setRefreshing(true);
    const [nextCollection, goalData] = await Promise.all([
      commerceApi.getCollection().catch(() => undefined),
      Promise.all([studioApi.getMine(), merchantApi.listMerchants()]).catch(() => undefined),
    ]);
    if (request !== generation.current) return;
    if (nextCollection) setCollection(nextCollection);
    setVisitGoal(nextCollection && goalData ? resolveStudioGoal(goalData[0].studio.goal, goalData[1], nextCollection) : undefined);
    setRefreshing(false);
  }, [commerceApi, merchantApi, studioApi]);

  useFocusEffect(useCallback(() => {
    const request = ++generation.current;
    void load(false, request);
    void refreshShop();
    return () => { if (request === generation.current) generation.current += 1; };
  }, [load, refreshShop]));

  return <SkyBackdrop>
    <SkyScrollView
      header={<BackHeader title="나의 전시" />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {
        void load(true);
        void shop.refreshQuietly();
        void experience.refresh();
      }} tintColor={palette.primary} colors={[palette.primary]} progressBackgroundColor={world.card} progressViewOffset={insets.top} />}
    >
      {experience.snapshot ? (
        <HomeCollectionDisplay experience={experience.snapshot} collection={collection} shop={shop.snapshot}
          visitGoal={visitGoal} apiUrl={apiUrl} />
      ) : (
        <View style={{ marginHorizontal: 14 }}>
          <StateScene kind={experience.error ? 'error' : 'loading'} title={experience.error ?? '전시를 확인하는 중'}
            action={experience.error ? { label: '다시 시도', onPress: () => { void experience.refresh(); } } : undefined} />
        </View>
      )}
    </SkyScrollView>
  </SkyBackdrop>;
}
