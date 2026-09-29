// The app's shareable links (Issue #230, spec §4): https://masscom.kr/open#friend=CODE and https://masscom.kr/open#merchant=ID.
// Values sit in the fragment because a fragment is never sent to a server, so a friend code stays out of web access logs and
// out of link-preview crawlers. A query (`?friend=`) is deliberately not read.
//
// Each installed build (production, showcase, development) has its own accounts and its own database, so a friend code from
// one build means nothing to another. A build therefore reads only its own links; a link that is recognisably MassCOM's but
// belongs to another build is reported as such, so its code is never sent to this build's API (where it would count as one
// of the ten allowed failures).

export const DEFAULT_LINK_ORIGIN = 'https://masscom.kr';
/** Where the showcase and development share texts point people to get an app. It carries no code and opens nothing on its own. */
export const APP_DOWNLOAD_LINK = `${DEFAULT_LINK_ORIGIN}/open`;

export type LinkVariant = 'production' | 'showcase' | 'development';

const PRODUCTION_PACKAGE = 'kr.masscom.wolgye';
const SHOWCASE_PACKAGE = 'kr.masscom.wolgye.demo';

/** Which build this is, by its installed package: production, showcase, and anything else (development) as the safe default. */
export function linkVariantFor(packageId: string | null | undefined): LinkVariant {
  if (packageId === PRODUCTION_PACKAGE) return 'production';
  if (packageId === SHOWCASE_PACKAGE) return 'showcase';
  return 'development';
}

const ownLinks = {
  production: { scheme: 'masscom', httpsHosts: ['masscom.kr', 'www.masscom.kr'] },
  // demo.masscom.kr has no DNS, web-server block or assetlinks entry yet, so the showcase build shares only its own scheme.
  showcase: { scheme: 'masscom-demo', httpsHosts: ['demo.masscom.kr'] },
  development: { scheme: 'masscom-dev', httpsHosts: ['masscom.kr', 'www.masscom.kr'] },
} as const satisfies Record<LinkVariant, { scheme: string; httpsHosts: readonly string[] }>;

const knownSchemes = new Set<string>(Object.values(ownLinks).map((links) => links.scheme));
const knownHttpsHosts = new Set<string>(Object.values(ownLinks).flatMap((links) => links.httpsHosts));
const linkPattern = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/is;

/**
 * The open link a build writes into its QR code: the public https link for production and development, and the showcase
 * build's own scheme, which the in-app scanner and the phone's camera app both open.
 */
export function openLinkBase(variant: LinkVariant): string {
  return variant === 'showcase' ? `${ownLinks.showcase.scheme}://open` : APP_DOWNLOAD_LINK;
}

function isOpenPath(path: string): boolean {
  return path === '/open' || path === '/open/';
}

/** Splits `a=1&b=two%20words` into values. The first of a repeated key wins and a broken escape drops only its own pair. */
export function parseFragmentParams(fragment: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const pair of fragment.split('&')) {
    const separator = pair.indexOf('=');
    const rawKey = separator < 0 ? pair : pair.slice(0, separator);
    const rawValue = separator < 0 ? '' : pair.slice(separator + 1);
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(rawKey);
      value = decodeURIComponent(rawValue);
    } catch {
      continue;
    }
    if (!key || key === '__proto__' || Object.hasOwn(values, key)) continue;
    values[key] = value;
  }
  return values;
}

/** A recognised MassCOM open link: its fragment values, and whether it belongs to this build (`ours`) or to another one. */
export type OpenLink = { ours: boolean; fragment: Record<string, string> };

/**
 * Reads an open link of any MassCOM build (an https App Link host with path /open, or a build's scheme with `open`), and says
 * whether this build owns it. Undefined means the text is no MassCOM link at all.
 */
export function readOpenLink(url: string, variant: LinkVariant): OpenLink | undefined {
  const match = linkPattern.exec(url.trim());
  if (!match) return undefined;
  const scheme = match[1]!.toLowerCase();
  const host = match[2]!.toLowerCase();
  const path = match[3]!;
  const fragment = parseFragmentParams(match[4] ?? '');
  const own = ownLinks[variant];
  if (scheme === 'https') {
    if (!knownHttpsHosts.has(host) || !isOpenPath(path)) return undefined;
    return { ours: (own.httpsHosts as readonly string[]).includes(host), fragment };
  }
  if (!knownSchemes.has(scheme)) return undefined;
  if (!((host === 'open' && (path === '' || path === '/')) || (host === '' && isOpenPath(path)))) return undefined;
  return { ours: scheme === own.scheme, fragment };
}

/** The fragment values of this build's own open link, or undefined when the text is not one (another build's link included). */
export function openLinkFragment(url: string, variant: LinkVariant): Record<string, string> | undefined {
  const link = readOpenLink(url, variant);
  return link?.ours ? link.fragment : undefined;
}
