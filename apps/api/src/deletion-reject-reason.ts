// The requester reads a rejection reason as written, by receipt, on a page anyone holding the receipt can open. So a reason
// must not carry personal data the operator typed by habit. It uses the same filter as the note of the visit and coupon
// reversal (#243, reversal-rules.ts), which looks at the NFKC form, so fullwidth digits, the fullwidth "@" and compatibility
// letters fold to ASCII first.
import { looksLikePersonalData } from './reversal-rules.js';

/** True when the text may contain an email, a web address or a phone-like number. It cannot catch names or street addresses. */
export function rejectReasonLooksPersonal(reason: string): boolean {
  return looksLikePersonalData(reason);
}
