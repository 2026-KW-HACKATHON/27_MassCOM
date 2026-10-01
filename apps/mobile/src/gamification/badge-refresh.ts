/**
 * Reward-open failure codes that mean the local badge book is now stale — a box already shown as READY/LOCKED
 * actually changed state server-side (e.g. the last coupon in that offer was just claimed by someone else) — and
 * must be refetched quietly instead of leaving the screen pointing at a reward that no longer matches reality.
 *
 * Shared by every screen that can open a reward box (PR #301 review: the home reward card did not refetch on
 * these codes, so an exhausted box could keep showing READY and `homeFeaturedReward`'s "first READY reward" pick
 * would keep returning it, hiding the next real READY box).
 */
export const quietBadgeRefreshCodes = new Set(['REWARD_LOCKED', 'REWARD_OFFER_UNAVAILABLE', 'REWARD_CAPACITY_EXHAUSTED', 'INVALID_RESPONSE']);

export function shouldRefreshBadgesQuietly(code: string | undefined): boolean {
  return code !== undefined && quietBadgeRefreshCodes.has(code);
}
