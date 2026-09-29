import { friendFromFragment, readFriendLink, type FriendLinkProblem, type FriendLinkRead } from './code';
import { parseFragmentParams, type LinkVariant } from './link';
import { merchantFromFragment, parseMerchantLink } from './recommend';

/**
 * Where an opened app link leads. A friend link that cannot be used (a mistyped code, or another MassCOM build's code) still
 * opens the friends tab, which says so in one line; everything else that is not a friend or merchant link keeps going home.
 */
export type OpenTarget =
  | { kind: 'friend'; code: string }
  | { kind: 'friend-problem'; problem: FriendLinkProblem }
  | { kind: 'merchant'; merchantId: string }
  | { kind: 'none' };

const none: OpenTarget = { kind: 'none' };

/** A valid friend code wins over a valid merchant id; a friend problem shows only when the link offers nothing usable. */
function targetFor(friend: FriendLinkRead, merchantId: string | undefined): OpenTarget {
  if (friend.kind === 'code') return { kind: 'friend', code: friend.code };
  if (merchantId) return { kind: 'merchant', merchantId };
  if (friend.kind === 'malformed') return { kind: 'friend-problem', problem: 'MALFORMED' };
  if (friend.kind === 'other-app') return { kind: 'friend-problem', problem: 'OTHER_APP' };
  return none;
}

export function parseOpenLink(url: string | null | undefined, variant: LinkVariant): OpenTarget {
  if (!url) return none;
  return targetFor(readFriendLink(url, variant), parseMerchantLink(url, variant));
}

/**
 * The router hands over the fragment as a route parameter without its `#`. It comes from a link the OS already routed to this
 * build, so it is read as this build's own and never as another build's.
 */
export function parseOpenFragment(fragment: string | null | undefined): OpenTarget {
  if (!fragment) return none;
  const values = parseFragmentParams(fragment.replace(/^#/, ''));
  return targetFor(friendFromFragment(values), merchantFromFragment(values));
}

const leadsSomewhere = (target: OpenTarget) => target.kind === 'friend' || target.kind === 'merchant';

/** What the open route should do: the link the OS delivered first, then the fragment the router parsed out of the same link. */
export function resolveOpenTarget(
  url: string | null | undefined,
  routerFragment: string | null | undefined,
  variant: LinkVariant,
): OpenTarget {
  const fromUrl = parseOpenLink(url, variant);
  if (leadsSomewhere(fromUrl)) return fromUrl;
  const fromFragment = parseOpenFragment(routerFragment);
  if (leadsSomewhere(fromFragment)) return fromFragment;
  return fromUrl.kind !== 'none' ? fromUrl : fromFragment;
}
