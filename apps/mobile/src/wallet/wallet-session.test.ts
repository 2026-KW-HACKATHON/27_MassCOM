import assert from 'node:assert/strict';
import test from 'node:test';

import { readApprovedEvmAccount } from './wallet-session';

test('reads an approved EVM account even when it is on a non-target chain', () => {
  const account = readApprovedEvmAccount(
    {
      session: {
        namespaces: {
          eip155: {
            accounts: ['eip155:1:0x1111111111111111111111111111111111111111'],
          },
        },
      },
    },
    84532,
  );

  assert.deepEqual(account, {
    address: '0x1111111111111111111111111111111111111111',
    chainId: 1,
  });
});

test('prefers an account already approved on the target chain', () => {
  const account = readApprovedEvmAccount(
    {
      session: {
        namespaces: {
          eip155: {
            accounts: [
              'eip155:1:0x1111111111111111111111111111111111111111',
              'eip155:84532:0x2222222222222222222222222222222222222222',
            ],
          },
        },
      },
    },
    84532,
  );

  assert.deepEqual(account, {
    address: '0x2222222222222222222222222222222222222222',
    chainId: 84532,
  });
});

test('ignores malformed or non-EVM session accounts', () => {
  assert.equal(
    readApprovedEvmAccount(
      {
        session: {
          namespaces: {
            eip155: {
              accounts: ['solana:devnet:not-an-evm-address', 'eip155:1:0x1234'],
            },
          },
        },
      },
      84532,
    ),
    undefined,
  );
});
