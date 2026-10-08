import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveRuntimeIdentity } from './showcase-identity';

const production = {
  googleWebClientId: '123-production.apps.googleusercontent.com',
  reownProjectId: 'production-project',
};

test('showcase installed package uses only its own Google ID and no inherited wallet project', () => {
  assert.deepEqual(resolveRuntimeIdentity('kr.masscom.wolgye.demo', {
    masscomShowcase: { googleWebClientId: '456-showcase.apps.googleusercontent.com' },
  }, production), {
    googleWebClientId: '456-showcase.apps.googleusercontent.com',
    reownProjectId: undefined,
  });
});

test('showcase installed package uses only its dedicated wallet project', () => {
  const reownProjectId = 'a'.repeat(32);
  assert.deepEqual(resolveRuntimeIdentity('kr.masscom.wolgye.demo', {
    masscomShowcase: {
      googleWebClientId: '456-showcase.apps.googleusercontent.com',
      reownProjectId,
    },
  }, production), {
    googleWebClientId: '456-showcase.apps.googleusercontent.com',
    reownProjectId,
  });
});

test('showcase missing or malformed ID never falls back to production', () => {
  for (const extra of [undefined, {}, { masscomShowcase: { googleWebClientId: 'invalid' } }]) {
    assert.deepEqual(resolveRuntimeIdentity('kr.masscom.wolgye.demo', extra, production), {
      googleWebClientId: undefined,
      reownProjectId: undefined,
    });
  }
  for (const reownProjectId of ['invalid', 'a'.repeat(31), 'a'.repeat(32) + 'x']) {
    assert.equal(resolveRuntimeIdentity('kr.masscom.wolgye.demo', {
      masscomShowcase: { reownProjectId },
    }, production).reownProjectId, undefined);
  }
});

test('production and development packages preserve existing configuration without showcase override', () => {
  for (const packageId of ['kr.masscom.wolgye', 'kr.masscom.wolgye.dev']) {
    assert.deepEqual(resolveRuntimeIdentity(packageId, {
      masscomShowcase: { googleWebClientId: '456-showcase.apps.googleusercontent.com' },
    }, production), production);
  }
});
