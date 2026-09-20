import assert from 'node:assert/strict';
import test from 'node:test';

import { makeError } from 'ethers';

import { contractCallError } from './ethers-chain-gateway.js';
import { ChainConfigurationError, RetryableChainError } from './mint-worker.js';

const callException = (data: string | null) =>
  makeError('call failed', 'CALL_EXCEPTION', {
    action: 'call',
    data,
    reason: null,
    transaction: { to: null, data: '0x' },
    invocation: null,
    revert: null,
  });

test('O02 a node error without EVM return data is an outage, not a contract mismatch', () => {
  for (const error of [
    callException(null),
    makeError('cancelled request', 'UNSUPPORTED_OPERATION', { operation: 'provider destroyed' }),
    makeError('connection refused', 'NETWORK_ERROR', { event: 'request' }),
    makeError('timeout', 'TIMEOUT', { operation: 'request', reason: 'timeout' }),
    new Error('socket hang up'),
  ]) {
    const classified = contractCallError(error);
    assert.ok(classified instanceof RetryableChainError, String(error));
    assert.equal(classified.code, 'RPC_UNAVAILABLE');
  }
});

test('O02 a real revert or undecodable return data is a contract interface mismatch', () => {
  for (const error of [
    callException('0x'),
    callException('0x08c379a0'),
    makeError('could not decode result data', 'BAD_DATA', { value: '0x', info: {} }),
  ]) {
    const classified = contractCallError(error);
    assert.ok(classified instanceof ChainConfigurationError, String(error));
    assert.equal(classified.code, 'CONTRACT_INTERFACE_MISMATCH');
  }
});
