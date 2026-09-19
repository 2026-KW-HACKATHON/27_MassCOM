import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAppKitGetWalletEvent,
  isAppKitUserRejectionEvent,
  isReownChainSwitchRejection,
  isWalletUserRejection,
} from './wallet-error';

test('recognizes EIP-1193 and WalletConnect user-rejection objects', () => {
  const rejectionCodes = [4001, 5000, 5001, 5002, 5003];

  for (const code of rejectionCodes) {
    assert.equal(isWalletUserRejection({ code, message: 'User rejected.' }), true);
  }

  assert.equal(isReownChainSwitchRejection(new Error('Chain is not supported')), true);
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

test('recognizes the Reown USER_REJECTED event emitted after a connection decline', () => {
  const event = {
    data: {
      type: 'track',
      event: 'USER_REJECTED',
      properties: { message: 'User rejected methods.' },
    },
    timestamp: 1,
  };

  assert.equal(isAppKitUserRejectionEvent(event), true);
  assert.equal(isWalletUserRejection(event), true);
});

test('does not treat near-miss AppKit events as a connection rejection', () => {
  assert.equal(
    isAppKitUserRejectionEvent({ data: { type: 'track', event: 'CONNECT_ERROR' }, timestamp: 2 }),
    false,
  );
  assert.equal(
    isAppKitUserRejectionEvent({ data: { event: 'USER_REJECTED' }, timestamp: 3 }),
    false,
  );
});

test('recognizes the AppKit store handoff for an uninstalled wallet', () => {
  assert.equal(
    isAppKitGetWalletEvent({
      data: {
        type: 'track',
        event: 'GET_WALLET',
        properties: { name: 'Trust Wallet', linkType: 'playstore' },
      },
      timestamp: 4,
    }),
    true,
  );
  assert.equal(
    isAppKitGetWalletEvent({ data: { type: 'track', event: 'CONNECT_ERROR' }, timestamp: 5 }),
    false,
  );
  assert.equal(isAppKitGetWalletEvent({ data: { event: 'GET_WALLET' }, timestamp: 6 }), false);
});

test('does not treat other provider failures as user cancellation', () => {
  assert.equal(isWalletUserRejection(new Error('{"code":-32000,"message":"Invalid chainId"}')), false);
  assert.equal(isWalletUserRejection({ code: 5100, message: 'Unsupported chains.' }), false);
  assert.equal(isWalletUserRejection({ code: '5000', message: 'Invalid code type.' }), false);
  assert.equal(isWalletUserRejection('User rejected the request.'), false);
  assert.equal(isReownChainSwitchRejection(new Error('Unrecognized chain.')), false);
  assert.equal(
    isReownChainSwitchRejection(Object.assign(new Error('Chain is not supported'), { code: 4902 })),
    false,
  );
});
