import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearPendingGradeDraw, readPendingGradeDraw, writePendingGradeDraw } from './grade-draw-pending';
import { pendingPurchaseScope } from './pending-purchase-storage';

test('an unanswered draw keeps its UUID and version across app entry, isolated by account', async () => {
  const storage = new Map<string, string>();
  const global = globalThis as unknown as { window?: unknown };
  const old = global.window;
  global.window = { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } };
  const one = pendingPurchaseScope({ accountId: 'a', apiUrl: 'https://api.example.test/a', appVariant: 'demo' });
  const relogin = pendingPurchaseScope({ accountId: 'a', apiUrl: 'https://api.example.test/b', appVariant: 'demo' });
  const other = pendingPurchaseScope({ accountId: 'b', apiUrl: 'https://api.example.test/a', appVariant: 'demo' });
  const pending = { grade: 'GOLD' as const, requestId: 'stable-id', expectedPoolVersion: 'version-1' };
  try {
    await writePendingGradeDraw(one, pending);
    assert.deepEqual(await readPendingGradeDraw(relogin), pending);
    assert.equal(await readPendingGradeDraw(other), null);
    await clearPendingGradeDraw(one);
    assert.equal(await readPendingGradeDraw(relogin), null);
  } finally { global.window = old; }
});
