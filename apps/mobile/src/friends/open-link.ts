import { parseFriendLink } from './code';
import { DEFAULT_LINK_ORIGIN } from './link';
import { parseMerchantLink } from './recommend';

/** Where an opened app link leads. Everything that is not a friend or merchant link keeps the old behaviour (home). */
export type OpenTarget =
  | { kind: 'friend'; code: string }
  | { kind: 'merchant'; merchantId: string }
  | { kind: 'none' };

const none: OpenTarget = { kind: 'none' };

export function parseOpenLink(url: string | null | undefined): OpenTarget {
  if (!url) return none;
  const code = parseFriendLink(url);
  if (code) return { kind: 'friend', code };
  const merchantId = parseMerchantLink(url);
  if (merchantId) return { kind: 'merchant', merchantId };
  return none;
}

/** The router hands over the fragment as a route parameter without its `#`; read it as if it were on our own link. */
export function parseOpenFragment(fragment: string | null | undefined): OpenTarget {
  if (!fragment) return none;
  return parseOpenLink(`${DEFAULT_LINK_ORIGIN}/open#${fragment.replace(/^#/, '')}`);
}
