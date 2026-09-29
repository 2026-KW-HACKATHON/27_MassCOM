// The requester reads a rejection reason as written, by receipt, on a page anyone holding the receipt can open. So a reason
// must not carry personal data the operator typed by habit. This mirrors the note filter of the visit and coupon reversal
// (#243): it looks at the NFKC form, so fullwidth digits, the fullwidth "@" and compatibility letters fold to ASCII first.
const personalDataPatterns = [
  /@/u, // email or social handle
  /https?:\/\/|www\./iu, // web address
  // An address without a scheme (instagram.com/x); only the common top-level domains are looked for.
  /[\p{L}\p{Nd}][\p{L}\p{Nd}-]*[.。](?:com|net|org|kr|co|io|me)(?![\p{L}\p{Nd}])/iu,
  // A long digit run such as a phone, card or order number. Digits may be separated by any run of non-letter, non-digit
  // characters (space, hyphen, slash, Unicode dashes) or by the Korean fillers and the hyphen-like ㅡ, which look empty or
  // like a dash on screen. Separator and digit sets do not overlap, so matching cannot backtrack badly, and the reason is at
  // most 200 characters.
  /(?:\p{Nd}(?:[^\p{L}\p{Nd}]|[ㅡᅳᅟᅠㅤﾠ])*){8,}/u,
];

/** True when the text may contain an email, a web address or a phone-like number. It cannot catch names or street addresses. */
export function rejectReasonLooksPersonal(reason: string): boolean {
  const probe = reason.normalize('NFKC');
  return personalDataPatterns.some((pattern) => pattern.test(probe));
}
