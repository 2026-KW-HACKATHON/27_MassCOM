// A friend link opened before sign-in has to survive the sign-in: the friends tab hands the code back once there is an account,
// then forgets it. It lives in memory only (never stored or logged), the same way a merchant return is remembered.
let pendingFriendCode: string | undefined;

export function rememberPendingFriendCode(code: string | undefined): void {
  pendingFriendCode = code;
}

export function peekPendingFriendCode(): string | undefined {
  return pendingFriendCode;
}

export function consumePendingFriendCode(): string | undefined {
  const code = pendingFriendCode;
  pendingFriendCode = undefined;
  return code;
}
