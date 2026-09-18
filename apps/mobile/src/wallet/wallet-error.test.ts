import assert from 'node:assert/strict';
import test from 'node:test';

import { isWalletUserRejection } from './wallet-error';

test('recognizes an EIP-1193 rejection object', () => {
  assert.equal(isWalletUserRejection({ code: 4001, message: 'User rejected the request.' }), true);
});

test('recognizes WalletConnect rejection JSON wrapped in an Error message', () => {
  assert.equal(
    isWalletUserRejection(new Error('{"code":4001,"message":"User rejected the request."}')),
    true,
  );
});

test('does not treat other provider failures as user cancellation', () => {
  assert.equal(isWalletUserRejection(new Error('{"code":-32000,"message":"Invalid chainId"}')), false);
  assert.equal(isWalletUserRejection('User rejected the request.'), false);
});
