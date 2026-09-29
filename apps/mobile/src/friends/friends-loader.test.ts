import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FriendsApiError, parseFriendsSnapshot, type FriendsSnapshot } from './friends-api';
import {
  createFriendsLoader,
  createLatestGate,
  failed,
  initialFriendsLoad,
  loaded,
  withMe,
  type FriendsLoad,
} from './friends-loader';

function snapshot(nickname: string, code = 'K7M2Q9XP'): FriendsSnapshot {
  return parseFriendsSnapshot({
    me: {
      nickname, code, badges: { earned: 3, total: 9 },
      medals: [{ key: 'explorer', tier: 1 }, { key: 'regular', tier: 1 }, { key: 'steady', tier: 1 }],
      rank: 1, asOf: '2026-09-28',
    },
    friends: [],
  });
}

/** An api whose answers finish only when the test says so, in any order. */
function controlledApi() {
  const pending: { resolve: (value: FriendsSnapshot) => void; reject: (error: unknown) => void }[] = [];
  return {
    api: {
      getFriends: () => new Promise<FriendsSnapshot>((resolve, reject) => { pending.push({ resolve, reject }); }),
    },
    pending,
  };
}

function harness() {
  const seen = { state: initialFriendsLoad as FriendsLoad, renders: 0 };
  const apply = (update: (state: FriendsLoad) => FriendsLoad) => {
    seen.state = update(seen.state);
    seen.renders += 1;
  };
  return { seen, apply };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('the gate lets only the newest request apply its answer', () => {
  const gate = createLatestGate();
  const first = gate.begin();
  assert.equal(gate.isLatest(first), true);
  const second = gate.begin();
  assert.equal(gate.isLatest(first), false);
  assert.equal(gate.isLatest(second), true);
  gate.invalidate();
  assert.equal(gate.isLatest(second), false, 'a local change or teardown outdates every request in flight');
  assert.equal(gate.isLatest(gate.begin()), true);
});

test('a first load starts as loading and becomes ready with the snapshot', async () => {
  const { api, pending } = controlledApi();
  const { seen, apply } = harness();
  const loader = createFriendsLoader(api, apply);
  const done = loader.load(false);
  assert.equal(seen.state.status, 'loading');
  pending[0]!.resolve(snapshot('첫째'));
  await done;
  assert.equal(seen.state.status, 'ready');
  assert.equal(seen.state.snapshot?.me.nickname, '첫째');
  assert.equal(seen.state.error, undefined);
});

test('answers that arrive out of order are ignored: the newest request wins, whichever finishes last', async () => {
  const { api, pending } = controlledApi();
  const { seen, apply } = harness();
  const loader = createFriendsLoader(api, apply);
  const older = loader.load(false);
  const newer = loader.load(true);
  // The newer request answers first, then the older one straggles in with stale data.
  pending[1]!.resolve(snapshot('새 값'));
  await newer;
  pending[0]!.resolve(snapshot('옛 값'));
  await older;
  assert.equal(seen.state.snapshot?.me.nickname, '새 값');
  assert.equal(seen.renders, 1, 'the stale answer changed nothing');
});

test('a stale failure is ignored as well, so it cannot flip a good screen to an error', async () => {
  const { api, pending } = controlledApi();
  const { seen, apply } = harness();
  const loader = createFriendsLoader(api, apply);
  const older = loader.load(false);
  const newer = loader.load(true);
  pending[1]!.resolve(snapshot('새 값'));
  await newer;
  pending[0]!.reject(new FriendsApiError(0, 'NETWORK_ERROR'));
  await older;
  assert.equal(seen.state.status, 'ready');
  assert.equal(seen.state.error, undefined);
});

test('a quiet refresh that fails keeps the screen ready and keeps the snapshot; a first load or retry that fails is an error', async () => {
  const { api, pending } = controlledApi();
  const { seen, apply } = harness();
  const loader = createFriendsLoader(api, apply);
  const first = loader.load(false);
  pending[0]!.resolve(snapshot('나'));
  await first;

  const quiet = loader.load(true);
  const networkDown = new FriendsApiError(0, 'NETWORK_ERROR');
  pending[1]!.reject(networkDown);
  await quiet;
  assert.equal(seen.state.status, 'ready');
  assert.equal(seen.state.snapshot?.me.nickname, '나');
  assert.equal(seen.state.error, networkDown);

  // A later success clears the remembered error.
  const again = loader.load(true);
  pending[2]!.resolve(snapshot('나'));
  await again;
  assert.equal(seen.state.status, 'ready');
  assert.equal(seen.state.error, undefined);

  // A retry (not quiet) that fails is shown as an error.
  const retry = loader.load(false);
  pending[3]!.reject(networkDown);
  await retry;
  assert.equal(seen.state.status, 'error');
});

test('a first load that fails is an error with nothing to show', async () => {
  const { api, pending } = controlledApi();
  const { seen, apply } = harness();
  const done = createFriendsLoader(api, apply).load(false);
  pending[0]!.reject(new FriendsApiError(0, 'NETWORK_ERROR'));
  await done;
  assert.equal(seen.state.status, 'error');
  assert.equal(seen.state.snapshot, undefined);
  // Even a quiet load has nothing to keep when the screen never became ready.
  assert.equal(failed(initialFriendsLoad, new Error('x'), true).status, 'error');
});

test('a confirmed change shows at once and outdates a refresh that was already on its way', async () => {
  const { api, pending } = controlledApi();
  const { seen, apply } = harness();
  const loader = createFriendsLoader(api, apply);
  const first = loader.load(false);
  pending[0]!.resolve(snapshot('나', 'K7M2Q9XP'));
  await first;

  const inFlight = loader.load(true);
  loader.changeMe({ code: '23456789' });
  assert.equal(seen.state.snapshot?.me.code, '23456789', 'shown before any refresh answers');
  // The refresh that started before the change would bring the old code back; it is dropped.
  pending[1]!.resolve(snapshot('나', 'K7M2Q9XP'));
  await inFlight;
  assert.equal(seen.state.snapshot?.me.code, '23456789');
  // The refresh the change started answers with the server's view and wins.
  pending[2]!.resolve(snapshot('나', '23456789'));
  await flush();
  assert.equal(seen.state.snapshot?.me.code, '23456789');
  assert.equal(pending.length, 3);
});

test('a change before there is a snapshot changes nothing, and the answer after dispose is dropped', async () => {
  assert.deepEqual(withMe(initialFriendsLoad, { nickname: '별명' }), initialFriendsLoad);
  const { api, pending } = controlledApi();
  const { seen, apply } = harness();
  const loader = createFriendsLoader(api, apply);
  const done = loader.load(false);
  loader.dispose();
  pending[0]!.resolve(snapshot('늦은 답'));
  await done;
  assert.equal(seen.state.status, 'loading');
  assert.equal(seen.renders, 0);
});

test('transitions do not mutate the state they were given', () => {
  const start: FriendsLoad = loaded(initialFriendsLoad, snapshot('나'));
  const frozen = JSON.stringify(start);
  failed(start, new Error('x'), true);
  withMe(start, { nickname: '바뀐 별명' });
  assert.equal(JSON.stringify(start), frozen);
});

test('useFriends is only glue: it builds one loader per api and disposes it on teardown', () => {
  const hook = readFileSync(fileURLToPath(new URL('./use-friends.ts', import.meta.url)), 'utf8');
  assert.match(hook, /useMemo\(\(\) => createFriendsLoader\(api, setState\), \[api\]\)/);
  assert.match(hook, /void loader\.load\(false\);\s*return \(\) => loader\.dispose\(\);/);
  assert.match(hook, /useCallback\(\(\) => loader\.load\(true\), \[loader\]\)/);
  assert.match(hook, /loader\.changeMe\(change\)/);
});
