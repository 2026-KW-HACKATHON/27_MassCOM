import { getAppPackageId } from '@/config/app-identity';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { linkVariantFor } from '@/friends/link';
import { resolveOpenTarget } from '@/friends/open-link';
import { rememberPendingFriendCode, rememberPendingFriendProblem } from '@/friends/pending-friend-link';

/**
 * The HTTPS App Link (and custom scheme) entry. `#friend=CODE` goes to the friends tab and asks about adding that code (after
 * sign-in when there is no account yet), a friend link that cannot be used goes to the friends tab with one line saying why,
 * `#merchant=ID` goes to that shop's page; anything else keeps going home.
 * The code rides in the fragment, which is never sent to a server; the OS hands the whole link over, fragment included.
 * Each build reads only its own links (production, showcase or development), by its installed package.
 */
export default function OpenRoute() {
  const router = useRouter();
  const url = Linking.useLinkingURL();
  const params = useLocalSearchParams<{ '#'?: string }>();
  const fragment = typeof params['#'] === 'string' ? params['#'] : undefined;
  const handled = useRef<string>(undefined);

  useEffect(() => {
    const key = `${url ?? ''}|${fragment ?? ''}`;
    if (handled.current === key) return;
    handled.current = key;
    const target = resolveOpenTarget(url, fragment, linkVariantFor(getAppPackageId()));
    if (target.kind === 'friend') {
      // Remembered before the move so the friends tab, or the sign-in that comes first, can pick it up.
      rememberPendingFriendCode(target.code);
      router.replace('/friends');
    } else if (target.kind === 'friend-problem') {
      rememberPendingFriendProblem(target.problem);
      router.replace('/friends');
    } else if (target.kind === 'merchant') {
      router.replace({ pathname: '/merchants/[merchantId]', params: { merchantId: target.merchantId } });
    } else {
      router.replace('/');
    }
    // iOS keeps handing the first universal link back as the "initial" link; once it is handled, forget it so a later visit to
    // this route reads only the link (or fragment) that actually opened it. A no-op on web.
    Linking.clearInitialURL();
  }, [fragment, router, url]);

  return null;
}
