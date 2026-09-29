import { createHmac, randomBytes } from 'node:crypto';

// Crockford Base32: 32 symbols, so the low five bits of a random byte are unbiased. I, L, O and U are left out
// because they are easy to misread or mistype when a person copies the receipt by hand.
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 16 random symbols (80 bits) in four groups, e.g. `7K2M-Q9XD-4HTB-0RWE`. */
export function generateReceipt(random: (size: number) => Buffer = randomBytes): string {
  let symbols = '';
  for (const byte of random(16)) symbols += alphabet[byte & 31];
  return symbols.match(/.{4}/g)!.join('-');
}

/** Case, hyphens and spaces are ignored and O/I/L are read as 0/1/1. Anything else is not a receipt. */
export function normalizeReceipt(input: string): string | undefined {
  if (input.length > 64) return undefined;
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(cleaned) ? cleaned : undefined;
}

/** Only this digest is stored. A malformed value hashes as the empty string, which never matches a stored row. */
export function receiptHash(hmacSecret: string, input: string): Buffer {
  return createHmac('sha256', hmacSecret)
    .update(`deletion-receipt:${normalizeReceipt(input) ?? ''}`)
    .digest();
}
