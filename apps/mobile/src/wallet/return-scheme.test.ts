import assert from 'node:assert/strict';
import { test } from 'node:test';

test('installed package determines the wallet return scheme when Expo config is absent', async () => {
  const { resolveWalletReturnScheme } = await import('./return-scheme.js');
  assert.equal(resolveWalletReturnScheme(undefined, 'kr.masscom.wolgye'), 'masscom');
  assert.equal(resolveWalletReturnScheme(undefined, 'kr.masscom.wolgye.dev'), 'masscom-dev');
  assert.equal(resolveWalletReturnScheme(undefined, 'kr.masscom.wolgye.demo'), 'masscom-demo');
});

test('configured string or array must match the installed package', async () => {
  const { resolveWalletReturnScheme } = await import('./return-scheme.js');
  assert.equal(resolveWalletReturnScheme('masscom-demo', 'kr.masscom.wolgye.demo'), 'masscom-demo');
  assert.equal(resolveWalletReturnScheme(['masscom-demo'], 'kr.masscom.wolgye.demo'), 'masscom-demo');
  assert.throws(() => resolveWalletReturnScheme('masscom-dev', 'kr.masscom.wolgye.demo'),
    /WALLET_RETURN_SCHEME_MISMATCH/);
});

test('unknown installed package and missing scheme fail closed', async () => {
  const { resolveWalletReturnScheme } = await import('./return-scheme.js');
  assert.throws(() => resolveWalletReturnScheme('masscom', 'com.other.app'),
    /WALLET_RETURN_SCHEME_UNAVAILABLE/);
  assert.throws(() => resolveWalletReturnScheme(undefined, undefined),
    /WALLET_RETURN_SCHEME_UNAVAILABLE/);
  assert.equal(resolveWalletReturnScheme('masscom-dev', undefined), 'masscom-dev');
});
