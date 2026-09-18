import assert from 'node:assert/strict';
import test from 'node:test';

import { isWalletUserRejection } from './wallet-error';

test('recognizes EIP-1193 and WalletConnect user-rejection objects', () => {
  const rejectionCodes = [4001, 5000, 5001, 5002, 5003];

  for (const code of rejectionCodes) {
    assert.equal(isWalletUserRejection({ code, message: 'User rejected.' }), true);
  }
});

test('recognizes WalletConnect rejection JSON wrapped in an Error message', () => {
  assert.equal(
    isWalletUserRejection(new Error('{"code":4001,"message":"User rejected the request."}')),
    true,
  );
  assert.equal(
    isWalletUserRejection(new Error('{"code":5003,"message":"User rejected events."}')),
    true,
  );
});

test('does not treat other provider failures as user cancellation', () => {
  assert.equal(isWalletUserRejection(new Error('{"code":-32000,"message":"Invalid chainId"}')), false);
  assert.equal(isWalletUserRejection({ code: 5100, message: 'Unsupported chains.' }), false);
  assert.equal(isWalletUserRejection({ code: '5000', message: 'Invalid code type.' }), false);
  assert.equal(isWalletUserRejection('User rejected the request.'), false);
});
