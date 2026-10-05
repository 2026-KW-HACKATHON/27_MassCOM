import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const config = require('../../metro.config.js');
test('only the shared scoring source maps its NodeNext import to actual TS source', () => {
  const originModulePath = fileURLToPath(new URL('../../../api/src/play-rules-quality.ts', import.meta.url));
  const resolveRequest = () => ({ type: 'delegated' });
  assert.deepEqual(config.resolver.resolveRequest({ originModulePath, resolveRequest }, './play-rules.js', 'web'), {
    type: 'sourceFile', filePath: fileURLToPath(new URL('../../../api/src/play-rules.ts', import.meta.url)),
  });
  assert.deepEqual(config.resolver.resolveRequest({ originModulePath: '/unrelated.ts', resolveRequest }, './play-rules.js', 'android'), { type: 'delegated' });
  assert.deepEqual(config.resolver.resolveRequest({ originModulePath, resolveRequest }, 'react-native', 'android'), { type: 'delegated' });
});
