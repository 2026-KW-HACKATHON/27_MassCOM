import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AUTH_SESSION_STORAGE_KEY,
  AuthStorageError,
  createSessionStore,
  type StoredAuthSessionV1,
} from './session-store';

const now = () => new Date('2026-09-21T12:00:00.000Z');
const validSession: StoredAuthSessionV1 = {
  version: 1,
  sessionToken: 'server-session-token',
  accountId: 'account-1',
  expiresAt: '2026-09-21T13:00:00.000Z',
};

function fakeSecureStore(initialValue: string | null = null) {
  let value = initialValue;
  let deleteCount = 0;
  let readError: Error | undefined;
  let writeError: Error | undefined;
  let deleteError: Error | undefined;
  return {
    surface: {
      async getItemAsync(key: string) {
        assert.equal(key, AUTH_SESSION_STORAGE_KEY);
        if (readError) throw readError;
        return value;
      },
      async setItemAsync(key: string, nextValue: string) {
        assert.equal(key, AUTH_SESSION_STORAGE_KEY);
        if (writeError) throw writeError;
        value = nextValue;
      },
      async deleteItemAsync(key: string) {
        assert.equal(key, AUTH_SESSION_STORAGE_KEY);
        if (deleteError) throw deleteError;
        deleteCount += 1;
        value = null;
      },
    },
    value: () => value,
    deleteCount: () => deleteCount,
    failRead(error: Error) {
      readError = error;
    },
    failWrite(error: Error) {
      writeError = error;
    },
    failDelete(error: Error) {
      deleteError = error;
    },
  };
}

test('restores one valid v1 server session', async () => {
  const fake = fakeSecureStore(JSON.stringify(validSession));
  const session = await createSessionStore(fake.surface, now).load();
  assert.deepEqual(session, validSession);
  assert.equal(fake.deleteCount(), 0);
});

test('deletes an expired session instead of restoring it', async () => {
  const fake = fakeSecureStore(JSON.stringify({
    ...validSession,
    expiresAt: '2026-09-21T12:00:00.000Z',
  }));
  const session = await createSessionStore(fake.surface, now).load();
  assert.equal(session, undefined);
  assert.equal(fake.deleteCount(), 1);
});

test('deletes every malformed or unsupported record', async () => {
  const invalidRecords = [
    '{not-json',
    JSON.stringify({ ...validSession, version: 2 }),
    JSON.stringify({ ...validSession, sessionToken: '' }),
    JSON.stringify({ ...validSession, accountId: '   ' }),
    JSON.stringify({ ...validSession, expiresAt: 'not-a-date' }),
  ];

  for (const raw of invalidRecords) {
    const fake = fakeSecureStore(raw);
    assert.equal(await createSessionStore(fake.surface, now).load(), undefined, raw);
    assert.equal(fake.deleteCount(), 1, raw);
  }
});

test('wraps storage read and write failures without leaking their messages', async () => {
  const readFake = fakeSecureStore();
  readFake.failRead(new Error('server-session-token leaked by storage'));
  await assert.rejects(
    createSessionStore(readFake.surface, now).load(),
    (error) =>
      error instanceof AuthStorageError
      && error.code === 'READ_FAILED'
      && !error.message.includes('server-session-token'),
  );

  const writeFake = fakeSecureStore();
  writeFake.failWrite(new Error('server-session-token leaked by storage'));
  await assert.rejects(
    createSessionStore(writeFake.surface, now).save(validSession),
    (error) =>
      error instanceof AuthStorageError
      && error.code === 'WRITE_FAILED'
      && !error.message.includes('server-session-token'),
  );
});

test('writes only the versioned server session fields', async () => {
  const fake = fakeSecureStore();
  await createSessionStore(fake.surface, now).save(validSession);
  const saved = JSON.parse(fake.value() ?? '{}') as Record<string, unknown>;
  assert.deepEqual(Object.keys(saved).sort(), ['accountId', 'expiresAt', 'sessionToken', 'version']);
  assert.deepEqual(saved, validSession);
});

test('wraps delete failures with a fixed code', async () => {
  const fake = fakeSecureStore(JSON.stringify({ ...validSession, expiresAt: 'expired' }));
  fake.failDelete(new Error('server-session-token leaked by delete'));
  await assert.rejects(
    createSessionStore(fake.surface, now).load(),
    (error) =>
      error instanceof AuthStorageError
      && error.code === 'DELETE_FAILED'
      && !error.message.includes('server-session-token'),
  );
});
