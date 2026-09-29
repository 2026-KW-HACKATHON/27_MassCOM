import type { FriendLinkProblem } from './code';

// A friend link opened before sign-in has to survive the sign-in: the friends tab hands the code back once there is an account,
// then forgets it. It lives in memory only (never stored or logged), the same way a merchant return is remembered, and it
// expires after half an hour so a link nobody acted on cannot surface as a surprise dialog much later. It is also forgotten when
// the account signs out or its session ends, so a code opened under one account is never offered to the next one.
// A friend link that cannot be used leaves a problem instead of a code, so the friends tab can say so once.
export const PENDING_FRIEND_CODE_TTL_MS = 30 * 60 * 1000;

type Pending =
  | { kind: 'code'; code: string; expiresAt: number }
  | { kind: 'problem'; problem: FriendLinkProblem; expiresAt: number };

let pending: Pending | undefined;

function live(now: number): Pending | undefined {
  if (pending && now >= pending.expiresAt) pending = undefined;
  return pending;
}

export function rememberPendingFriendCode(code: string | undefined, now: number = Date.now()): void {
  pending = code === undefined ? undefined : { kind: 'code', code, expiresAt: now + PENDING_FRIEND_CODE_TTL_MS };
}

export function peekPendingFriendCode(now: number = Date.now()): string | undefined {
  const current = live(now);
  return current?.kind === 'code' ? current.code : undefined;
}

export function consumePendingFriendCode(now: number = Date.now()): string | undefined {
  const code = peekPendingFriendCode(now);
  if (code !== undefined) pending = undefined;
  return code;
}

export function rememberPendingFriendProblem(problem: FriendLinkProblem, now: number = Date.now()): void {
  pending = { kind: 'problem', problem, expiresAt: now + PENDING_FRIEND_CODE_TTL_MS };
}

export function consumePendingFriendProblem(now: number = Date.now()): FriendLinkProblem | undefined {
  const current = live(now);
  if (current?.kind !== 'problem') return undefined;
  pending = undefined;
  return current.problem;
}

/** Whether a friend link (a code or a problem) is waiting for the friends tab. */
export function hasPendingFriendLink(now: number = Date.now()): boolean {
  return live(now) !== undefined;
}

/** Forgets whatever is waiting: called when the account signs out or its session is invalidated. */
export function clearPendingFriendLink(): void {
  pending = undefined;
}
