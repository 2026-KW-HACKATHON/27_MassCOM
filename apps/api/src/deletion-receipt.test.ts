import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateReceipt, normalizeReceipt, receiptHash } from './deletion-receipt.js';

const secret = 'receipt-unit-test-secret-at-least-32-bytes';

test('a receipt is 16 readable symbols in four hyphenated groups with no ambiguous letters', () => {
  for (let index = 0; index < 200; index += 1) {
    const receipt = generateReceipt();
    assert.match(receipt, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    assert.doesNotMatch(receipt, /[ILOU]/);
  }
  assert.equal(new Set(Array.from({ length: 200 }, () => generateReceipt())).size, 200);
});

test('every byte maps to one symbol without modulo bias', () => {
  const symbols = new Set<string>();
  for (let byte = 0; byte < 256; byte += 1) {
    symbols.add(generateReceipt(() => Buffer.alloc(16, byte)).replaceAll('-', '')[0]!);
  }
  assert.equal(symbols.size, 32);
});

test('normalization ignores case, separators and look-alike letters but rejects other input', () => {
  assert.equal(normalizeReceipt('7k2m-q9xd-4htb-0rwe'), '7K2MQ9XD4HTB0RWE');
  assert.equal(normalizeReceipt(' 7K2M Q9XD 4HTB ORWE '), '7K2MQ9XD4HTB0RWE');
  assert.equal(normalizeReceipt('IIII-LLLL-oooo-1111'), '1111111100001111');
  for (const bad of ['', '7K2M-Q9XD-4HTB', '7K2M-Q9XD-4HTB-0RWEE', 'UUUU-UUUU-UUUU-UUUU', '가나다라-마바사아-자차카타-파하가나',
    '7K2M-Q9XD-4HTB-0RW!', 'A'.repeat(65)]) {
    assert.equal(normalizeReceipt(bad), undefined, bad);
  }
});

test('the stored digest is keyed, stable across spellings and never the receipt itself', () => {
  const receipt = '7K2M-Q9XD-4HTB-0RWE';
  const digest = receiptHash(secret, receipt);
  assert.equal(digest.length, 32);
  assert.deepEqual(receiptHash(secret, '7k2mq9xd4htbORWE'), digest);
  assert.notDeepEqual(receiptHash('another-secret-that-is-at-least-32-bytes', receipt), digest);
  assert.equal(digest.toString('hex').includes('7K2M'), false);
  assert.deepEqual(receiptHash(secret, 'not a receipt'), receiptHash(secret, ''));
});
