// The app's shareable links (Issue #230, spec §4): https://masscom.kr/open#friend=CODE and https://masscom.kr/open#merchant=ID.
// Values sit in the fragment because a fragment is never sent to a server, so a friend code stays out of web access logs and
// out of link-preview crawlers. A query (`?friend=`) is deliberately not read.

export const DEFAULT_LINK_ORIGIN = 'https://masscom.kr';
/** The showcase app owns demo.masscom.kr/open (app.config.ts), so its links must point there to open the showcase app. */
export const DEMO_LINK_ORIGIN = 'https://demo.masscom.kr';

export function linkOriginFor(packageId: string | null | undefined): string {
  return packageId === 'kr.masscom.wolgye.demo' ? DEMO_LINK_ORIGIN : DEFAULT_LINK_ORIGIN;
}

const httpsHosts = new Set(['masscom.kr', 'www.masscom.kr', 'demo.masscom.kr']);
const appSchemes = new Set(['masscom', 'masscom-demo', 'masscom-dev']);
const linkPattern = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/is;

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

/**
 * The fragment values of one of our own open links, or undefined when the text is not one: the https App Link hosts
 * (`masscom.kr`, `www.masscom.kr`, `demo.masscom.kr` with path /open) or a variant's custom scheme (`masscom://open`).
 */
export function openLinkFragment(url: string): Record<string, string> | undefined {
  const match = linkPattern.exec(url.trim());
  if (!match) return undefined;
  const scheme = match[1]!.toLowerCase();
  const host = match[2]!.toLowerCase();
  const path = match[3]!;
  const fragment = match[4] ?? '';
  const ours = scheme === 'https'
    ? httpsHosts.has(host) && isOpenPath(path)
    : appSchemes.has(scheme) && ((host === 'open' && (path === '' || path === '/')) || (host === '' && isOpenPath(path)));
  return ours ? parseFragmentParams(fragment) : undefined;
}
