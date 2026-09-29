// A friend link opened before sign-in has to survive the sign-in: the friends tab hands the code back once there is an account,
// then forgets it. It lives in memory only (never stored or logged), the same way a merchant return is remembered, and it
// expires after half an hour so a link nobody acted on cannot surface as a surprise dialog much later.
export const PENDING_FRIEND_CODE_TTL_MS = 30 * 60 * 1000;

let pending: { code: string; expiresAt: number } | undefined;

export function rememberPendingFriendCode(code: string | undefined, now: number = Date.now()): void {
  pending = code === undefined ? undefined : { code, expiresAt: now + PENDING_FRIEND_CODE_TTL_MS };
}

export function peekPendingFriendCode(now: number = Date.now()): string | undefined {
  if (pending && now >= pending.expiresAt) pending = undefined;
  return pending?.code;
}

export function consumePendingFriendCode(now: number = Date.now()): string | undefined {
  const code = peekPendingFriendCode(now);
  pending = undefined;
  return code;
}
