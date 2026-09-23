import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canRenderScreen } from './screen-access';

test('only the empty entry and redirect are public during all auth transitions', () => {
  for (const status of ['signedOut', 'restoring', 'switchingAccount', 'error']) {
    assert.equal(canRenderScreen('index', status), true);
    assert.equal(canRenderScreen('open', status), true);
    for (const route of ['(tabs)', 'wallet', 'merchant', 'merchants/[merchantId]', 'recommendations', 'other/index']) {
      assert.equal(canRenderScreen(route, status), false, `${route}: ${status}`);
    }
  }
});

test('existing authenticated and configured demo sessions retain feature access', () => {
  for (const status of ['signedIn', 'demo']) {
    for (const route of ['(tabs)', 'wallet', 'merchant', 'merchants/[merchantId]', 'recommendations']) {
      assert.equal(canRenderScreen(route, status), true);
    }
  }
});
