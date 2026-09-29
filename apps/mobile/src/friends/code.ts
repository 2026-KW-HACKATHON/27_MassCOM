import { APP_DOWNLOAD_LINK, openLinkBase, readOpenLink, type LinkVariant } from './link';

// A friend code is 8 characters from a 32-letter table without the look-alikes 0, O, 1 and I (apps/api/src/friends-rules.ts).
export const FRIEND_CODE_LENGTH = 8;
const friendCodePattern = /^[2-9A-HJ-NP-Z]{8}$/;
const friendCodeCharacter = /^[2-9A-HJ-NP-Z]$/;

/** Same normalisation the server applies: upper case, and no spaces or hyphens of any width. */
export function normalizeFriendCode(input: string): string {
  return input.toUpperCase().replace(/[\s\-‐-―−－]/g, '');
}

export type FriendCodeCheck =
  | { ok: true; code: string }
  | { ok: false; reason: 'EMPTY' | 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_CHARACTER' };

export function validateFriendCode(input: string): FriendCodeCheck {
  const code = normalizeFriendCode(input);
  if (code.length === 0) return { ok: false, reason: 'EMPTY' };
  const characters = Array.from(code);
  if (!characters.every((character) => friendCodeCharacter.test(character))) return { ok: false, reason: 'INVALID_CHARACTER' };
  if (characters.length < FRIEND_CODE_LENGTH) return { ok: false, reason: 'TOO_SHORT' };
  if (characters.length > FRIEND_CODE_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, code };
}

/** "K7M2-Q9XP": two groups of four are easier to read aloud and copy by eye. */
export function formatFriendCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function friendCodeAccessibilityLabel(code: string): string {
  return `친구 코드 ${Array.from(code).join(', ')}`;
}

/** What a build puts into its QR: the public https link, or the showcase build's own scheme link (spec §8, D-047). */
export function friendLink(code: string, variant: LinkVariant = 'production'): string {
  if (!friendCodePattern.test(code)) throw new Error('FRIEND_CODE_INVALID');
  return `${openLinkBase(variant)}#friend=${code}`;
}

/**
 * The system share text: the code for people who type it and, outside the showcase build, the link for people who tap it.
 * The text carries the code in plain characters, so whatever messenger sends it can read it. The showcase build has no https
 * host of its own yet, so its text carries the code and the public download link only, and never a link that cannot open.
 */
export function friendShareMessage(code: string, variant: LinkVariant = 'production'): string {
  if (variant === 'showcase') {
    return `MassCOM 시연 앱 친구 코드: ${formatFriendCode(code)}\n앱의 친구 탭에서 코드를 넣어 주세요.\n앱 받기: ${APP_DOWNLOAD_LINK}`;
  }
  return `월계 마스코트에서 친구가 되어요! 내 친구 코드는 ${formatFriendCode(code)}예요.\n${friendLink(code, variant)}`;
}

/** What a link's `friend` value amounts to for this build. */
export type FriendLinkRead =
  | { kind: 'code'; code: string }
  /** Our own open link carries a `friend` value that is not a valid code. */
  | { kind: 'malformed' }
  /** Another MassCOM build's friend link: its code is for that build's accounts and is never sent to this build's API. */
  | { kind: 'other-app' }
  | { kind: 'none' };

export function friendFromFragment(fragment: Record<string, string>): FriendLinkRead {
  const value = fragment.friend;
  if (value === undefined) return { kind: 'none' };
  const checked = validateFriendCode(value);
  return checked.ok ? { kind: 'code', code: checked.code } : { kind: 'malformed' };
}

/** What a link says about a friend code, from this build's point of view. */
export function readFriendLink(url: string, variant: LinkVariant): FriendLinkRead {
  const link = readOpenLink(url, variant);
  if (!link) return { kind: 'none' };
  const read = friendFromFragment(link.fragment);
  if (read.kind === 'none') return read;
  return link.ours ? read : { kind: 'other-app' };
}

/** The code inside this build's own friend link (`#friend=CODE`), normalised, or undefined for anything else. */
export function parseFriendLink(url: string, variant: LinkVariant): string | undefined {
  const read = readFriendLink(url, variant);
  return read.kind === 'code' ? read.code : undefined;
}

export type FriendLinkProblem = 'MALFORMED' | 'OTHER_APP';

/** One plain line for a friend link or QR that cannot be used here. */
export function friendLinkProblemMessage(problem: FriendLinkProblem): string {
  return problem === 'MALFORMED'
    ? '링크의 친구 코드가 올바르지 않아요.'
    : '다른 MassCOM 앱(시연/운영)의 코드예요. 같은 앱끼리만 친구가 될 수 있어요.';
}

export function friendCodeProblemMessage(reason: Extract<FriendCodeCheck, { ok: false }>['reason']): string {
  switch (reason) {
    case 'EMPTY':
      return '친구 코드를 입력해 주세요.';
    case 'TOO_SHORT':
      return '코드는 8자리예요. 빠진 글자가 없는지 확인해 주세요.';
    case 'TOO_LONG':
      return '코드는 8자리예요. 글자가 더 들어갔는지 확인해 주세요.';
    case 'INVALID_CHARACTER':
      return '코드에는 헷갈리는 글자 0·O·1·I나 기호가 들어가지 않아요. 글자를 다시 확인해 주세요.';
  }
}

export type ScannedFriendCode =
  | { ok: true; code: string }
  | { ok: false; reason: 'EMPTY' | 'NOT_A_FRIEND_CODE' | 'OTHER_APP' };

/**
 * What a camera reads from a friend QR: this build's friend link, or a bare code. Any other QR (a payment, Wi-Fi settings, a
 * claim code) is refused here so it is never sent to the API or shown back, and so is another MassCOM build's friend link
 * (`OTHER_APP`), whose code belongs to that build's accounts. A bare code, typed or alone in a QR, still goes to the API.
 */
export function parseScannedFriendCode(raw: string, variant: LinkVariant): ScannedFriendCode {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'EMPTY' };
  const link = readFriendLink(value, variant);
  if (link.kind === 'code') return { ok: true, code: link.code };
  if (link.kind === 'other-app') return { ok: false, reason: 'OTHER_APP' };
  const bare = validateFriendCode(value);
  return bare.ok && !value.includes(':') && !value.includes('/') ? { ok: true, code: bare.code } : { ok: false, reason: 'NOT_A_FRIEND_CODE' };
}
