import type { Dispatch, SetStateAction } from 'react';

import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';
import { createFriendsApiClient } from '@/friends/friends-api';
import { createCoinApiClient, type CoinShop } from '@/shop/coin-api';
import { createShopApiClient, type ShopSnapshot } from '@/shop/shop-api';
import { createSocialApiClient } from '@/social/social-api';

/** What the header strip shows. A failed request keeps the earlier value instead of blanking it. */
export type DiscoveryStrip = { nickname?: string; intro?: string; shop?: ShopSnapshot; unread?: number; friendCount?: number };
export type Answers = { owner: object; strip: DiscoveryStrip; collection?: CollectionSnapshot; coinShop?: CoinShop; coinShopAt?: number };

/** One request at a time per call: a second caller joins the one in flight. */
export function joinInFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let flight: Promise<T> | undefined;
  return () => flight ??= run().finally(() => { flight = undefined; });
}

export type CallOptions = { apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>; fetcher?: typeof fetch };

export function createCalls(options: CallOptions, setAnswers: Dispatch<SetStateAction<Answers | undefined>>) {
  const owner = {};
  const friends = createFriendsApiClient(options);
  const shop = createShopApiClient(options);
  const social = createSocialApiClient(options);
  const commerce = createCommerceApiClient(options);
  const coins = createCoinApiClient(options);
  const merge = (patch: (current: Answers) => Partial<Answers>) =>
    setAnswers((current) => current?.owner === owner ? { ...current, ...patch(current) } : current);
  const loadCollection = joinInFlight(async () => { const value = await commerce.getCollection(); merge(() => ({ collection: value })); return value; });
  const loadCoinShop = joinInFlight(async () => { const value = await coins.getShop(); const at = Date.now(); merge(() => ({ coinShop: value, coinShopAt: at })); return value; });
  return {
    owner,
    /** The header strip: three requests, however often a screen gains focus. Never touches the stage answers. */
    loadStrip: joinInFlight(async () => {
      const [me, shopSnapshot, mail] = await Promise.allSettled([friends.getFriends(), shop.getShop(), social.getSocial()]);
      merge((current) => ({ strip: {
        ...current.strip,
        ...(me.status === 'fulfilled' ? { nickname: me.value.me.nickname, intro: me.value.me.intro, friendCount: me.value.friends.length } : {}),
        ...(shopSnapshot.status === 'fulfilled' ? { shop: shopSnapshot.value } : {}),
        ...(mail.status === 'fulfilled' ? { unread: mail.value.unreadMailCount } : {}),
      } }));
    }),
    loadCollection,
    loadCoinShop,
    /** The stage answers alone: Home asks for them with its own load, and a claim asks right after it succeeds (never on every focus). */
    loadStage: joinInFlight(async () => { await Promise.allSettled([loadCollection(), loadCoinShop()]); }),
  };
}

