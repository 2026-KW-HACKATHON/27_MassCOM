import { DEFAULT_LINK_ORIGIN, openLinkFragment } from './link';

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

export function friendLink(code: string, origin: string = DEFAULT_LINK_ORIGIN): string {
  if (!friendCodePattern.test(code)) throw new Error('FRIEND_CODE_INVALID');
  return `${origin}/open#friend=${code}`;
}

/** The system share text: the code for people who type it and the link for people who tap it. */
export function friendShareMessage(code: string, origin: string = DEFAULT_LINK_ORIGIN): string {
  return `월계 마스코트에서 친구가 되어요! 내 친구 코드는 ${formatFriendCode(code)}예요.\n${friendLink(code, origin)}`;
}

/** The code inside a friend link (`#friend=CODE`), normalised, or undefined for anything else. */
export function parseFriendLink(url: string): string | undefined {
  const value = openLinkFragment(url)?.friend;
  if (value === undefined) return undefined;
  const checked = validateFriendCode(value);
  return checked.ok ? checked.code : undefined;
}
