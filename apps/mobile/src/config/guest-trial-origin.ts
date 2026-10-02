import { isLoopbackHost } from './public-api';

const SHOWCASE_PACKAGE = 'kr.masscom.wolgye.demo';
const DEVELOPMENT_PACKAGE = 'kr.masscom.wolgye.dev';
const SHOWCASE_ORIGIN = 'https://demo-api.masscom.kr';

/**
 * Guest trial login is a showcase-only feature (PR #313 review): the real showcase build must
 * talk to the real showcase API, and only a local development build pointed at a loopback API
 * (scripts/qa-local.sh-style local QA) gets an exception. Every other combination — including a
 * `.dev` build pointed at a non-loopback host, or any package talking to the production API —
 * fails closed.
 */
export function isApprovedGuestTrialOrigin(
  packageId: string | null | undefined,
  apiUrl: string,
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
  if (packageId === SHOWCASE_PACKAGE) return origin === SHOWCASE_ORIGIN;
  if (packageId === DEVELOPMENT_PACKAGE) return isLoopbackHost(hostname);
  return false;
}
