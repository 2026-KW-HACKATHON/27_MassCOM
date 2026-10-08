import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DISCLOSURE_PREFIX, disclosureKey, emptyDisclosureRecord, loadDisclosureRecord, parseDisclosureRecord, purgeForeignDisclosureRecords,
  sameDisclosureRecord, saveDisclosureRecord, withProgress, type KeyValueStorage,
} from './disclosure-record';

function memoryStorage(initial: Record<string, string> = {}, failing = false): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key) => { if (failing) throw new Error('read failed'); return data.get(key) ?? null; },
    setItem: async (key, value) => { if (failing) throw new Error('write failed'); data.set(key, value); },
  };
}

test('nothing saved means nothing chosen and the first-coin stage', () => {
  assert.deepEqual(emptyDisclosureRecord, { optIn: { play: false }, reached: 'first-coin' });
});

test('a saved record round-trips per account without touching another account', async () => {
  const storage = memoryStorage();
  assert.equal(await saveDisclosureRecord(storage, 'acct-a', { optIn: { social: true, play: false }, reached: 'regular' }), true);
  assert.deepEqual(await loadDisclosureRecord(storage, 'acct-a'), { optIn: { social: true, play: false }, reached: 'regular' });
  assert.deepEqual(await loadDisclosureRecord(storage, 'acct-b'), emptyDisclosureRecord);
  assert.deepEqual(await loadDisclosureRecord(storage, undefined), emptyDisclosureRecord);
  assert.deepEqual([...storage.data.keys()], ['masscom.disclosure.v1:acct-a']);
  assert.equal(disclosureKey(undefined), 'masscom.disclosure.v1:signed-out');
});

test('saving writes only the known fields', async () => {
  const storage = memoryStorage();
  await saveDisclosureRecord(storage, 'a', { optIn: { social: true, play: true, extra: 1 } as never, reached: 'after-first', junk: 'x' } as never);
  assert.deepEqual(JSON.parse(storage.data.get(disclosureKey('a'))!), { optIn: { social: true, play: true }, reached: 'after-first' });
});

test('a damaged record falls back to "not chosen" instead of blocking the app', () => {
  for (const raw of ['not json', '[]', '"regular"', 'null', '7', '{}', '{"optIn":null}', '{"optIn":{"social":"true","play":1},"reached":"vip"}']) {
    assert.deepEqual(parseDisclosureRecord(raw), emptyDisclosureRecord, raw);
  }
  assert.deepEqual(parseDisclosureRecord('{"optIn":{"social":true},"reached":"after-first"}'), { optIn: { social: true, play: false }, reached: 'after-first' });
});

test('"social" is three-valued: never chosen stays unset, an explicit off is kept', async () => {
  assert.deepEqual(parseDisclosureRecord('{"optIn":{"social":false,"play":true},"reached":"regular"}'), { optIn: { social: false, play: true }, reached: 'regular' });
  assert.equal('social' in parseDisclosureRecord('{"optIn":{"play":true}}').optIn, false);
  const storage = memoryStorage();
  await saveDisclosureRecord(storage, 'a', { optIn: { social: false, play: false }, reached: 'first-coin' });
  assert.deepEqual(await loadDisclosureRecord(storage, 'a'), { optIn: { social: false, play: false }, reached: 'first-coin' });
  await saveDisclosureRecord(storage, 'b', emptyDisclosureRecord);
  assert.deepEqual(JSON.parse(storage.data.get(disclosureKey('b'))!), { optIn: { play: false }, reached: 'first-coin' });
});

test('an unreadable or unwritable store behaves like an empty one, and says so when saving fails', async () => {
  const broken = memoryStorage({}, true);
  assert.deepEqual(await loadDisclosureRecord(broken, 'a'), emptyDisclosureRecord);
  assert.equal(await saveDisclosureRecord(broken, 'a', emptyDisclosureRecord), false);
});

test('the furthest stage only moves forward', () => {
  const record = { optIn: { social: false, play: true }, reached: 'after-first' as const };
  assert.equal(withProgress(record, 'first-coin', 0), record, 'a lower stage returns the same record');
  assert.equal(withProgress(record, 'after-first', 0), record);
  assert.deepEqual(withProgress(record, 'regular', 0), { optIn: { social: false, play: true }, reached: 'regular' });
});

test('friends found on an account that has not chosen are remembered as an opt-in; a choice is never overwritten', () => {
  const unchosen = { optIn: { play: false }, reached: 'first-coin' as const };
  assert.deepEqual(withProgress(unchosen, 'first-coin', 2), { optIn: { play: false, social: true }, reached: 'first-coin' });
  assert.equal(withProgress(unchosen, 'first-coin', 0), unchosen, 'no friends: nothing to remember');
  assert.equal(withProgress(unchosen, 'first-coin', undefined), unchosen, 'friend count not loaded: nothing to remember');
  const off = { optIn: { social: false, play: false }, reached: 'first-coin' as const };
  assert.equal(withProgress(off, 'first-coin', 4), off, 'turned off in Settings stays off');
  assert.deepEqual(withProgress(unchosen, 'regular', 1), { optIn: { play: false, social: true }, reached: 'regular' }, 'stage and opt-in move together');
});

test('two records are the same when stage and both choices match', () => {
  const a = { optIn: { social: true, play: false }, reached: 'regular' as const };
  assert.equal(sameDisclosureRecord(a, { reached: 'regular', optIn: { play: false, social: true } }), true);
  assert.equal(sameDisclosureRecord(a, { ...a, reached: 'after-first' }), false);
  assert.equal(sameDisclosureRecord(a, { ...a, optIn: { social: undefined, play: false } }), false, 'unset is not off');
  assert.equal(sameDisclosureRecord(a, { ...a, optIn: { social: true, play: true } }), false);
});

test('signing in as another account removes the records other accounts left, and only those', async () => {
  const keys = [disclosureKey('mine'), disclosureKey('theirs'), disclosureKey(undefined), '@masscom:collection:x:favorites'];
  const removed: string[] = [];
  const count = await purgeForeignDisclosureRecords({
    accountId: 'mine',
    listStoredKeys: async () => keys.filter((key) => key.startsWith(DISCLOSURE_PREFIX)),
    removeStoredKeys: async (list) => { removed.push(...list); },
  });
  assert.equal(count, 2);
  assert.deepEqual(removed.sort(), [disclosureKey('theirs'), disclosureKey(undefined)].sort());
  // The purge itself also ignores anything outside the prefix even if the adapter lists it.
  const stray: string[] = [];
  await purgeForeignDisclosureRecords({ accountId: 'mine', listStoredKeys: async () => keys, removeStoredKeys: async (list) => { stray.push(...list); } });
  assert.equal(stray.includes('@masscom:collection:x:favorites'), false);
  assert.equal(stray.includes(disclosureKey('mine')), false);
});

test('a purge that finds nothing, or runs after the account changed again, removes nothing', async () => {
  let removals = 0;
  const remove = async () => { removals += 1; };
  assert.equal(await purgeForeignDisclosureRecords({ accountId: 'mine', listStoredKeys: async () => [disclosureKey('mine')], removeStoredKeys: remove }), 0);
  assert.equal(await purgeForeignDisclosureRecords({ accountId: 'mine', listStoredKeys: async () => [disclosureKey('theirs')], removeStoredKeys: remove, isStillCurrent: () => false }), 0);
  assert.equal(removals, 0);
});
