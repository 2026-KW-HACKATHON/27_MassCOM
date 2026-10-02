import { isLoopbackHost } from './public-api';

const SHOWCASE_PACKAGE = 'kr.masscom.wolgye.demo';
const DEVELOPMENT_PACKAGE = 'kr.masscom.wolgye.dev';

/**
 * Guest trial login is a showcase-only feature (PR #313 review): the real showcase build must
 * talk to the real showcase API, and only a local development build pointed at a loopback API
 * (scripts/qa-local.sh-style local QA) gets an exception. Every other combination — including a
 * `.dev` build pointed at a non-loopback host, or any package talking to the production API —
 * fails closed.
 *
 * The showcase origin comes from the showcase build's `extra.masscomShowcase.apiOrigin`
 * (app.config.ts), not from a literal here: this module ships in every variant, and a literal
 * would put the showcase host into the operating bundle, which scripts/check-embedded-api.sh
 * rejects (Issue #325). A build without that value, or with anything but a bare https origin,
 * never approves the showcase package.
 */
export function isApprovedGuestTrialOrigin(
  packageId: string | null | undefined,
  apiUrl: string,
  extra: unknown,
): boolean {
  let origin: string;
  let hostname: string;
  try {
    const url = new URL(apiUrl);
    origin = url.origin;
    hostname = url.hostname;
  } catch {
    return false;
  }
  if (packageId === SHOWCASE_PACKAGE) {
    const showcaseOrigin = showcaseApiOrigin(extra);
    return showcaseOrigin !== undefined && origin === showcaseOrigin;
  }
  if (packageId === DEVELOPMENT_PACKAGE) return isLoopbackHost(hostname);
  return false;
}

function showcaseApiOrigin(extra: unknown): string | undefined {
  const showcase = extra && typeof extra === 'object' ? Reflect.get(extra, 'masscomShowcase') : undefined;
  const value = showcase && typeof showcase === 'object' ? Reflect.get(showcase, 'apiOrigin') : undefined;
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value ? value : undefined;
  } catch {
    return undefined;
  }
}
