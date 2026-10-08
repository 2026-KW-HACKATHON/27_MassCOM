import assert from 'node:assert/strict';
import Module from 'node:module';
import { after, before, test } from 'node:test';
import type { AccountCredential } from '../auth/account-credential';
import { notifyGuestbookChanged } from './guestbook-state';

type Loader = (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
const modules = Module as unknown as { _load: Loader };
const originalLoad = modules._load;
const states: unknown[] = [];
let index = 0;
const effects: (() => void)[] = [];
const same = (left: readonly unknown[] | undefined, right: readonly unknown[]) => left?.length === right.length && right.every((value, i) => value === left[i]);
const fakeReact = {
  useState(initial: unknown) {
    const slot = index++;
    if (!(slot in states)) states[slot] = initial;
    return [states[slot], (next: unknown) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next; }];
  },
  useRef(initial: unknown) {
    const slot = index++;
    if (!(slot in states)) states[slot] = { current: initial };
    return states[slot];
  },
  useMemo(factory: () => unknown, deps: readonly unknown[]) {
    const slot = index++;
    const previous = states[slot] as { deps: readonly unknown[]; value: unknown } | undefined;
    if (!previous || !same(previous.deps, deps)) states[slot] = { deps, value: factory() };
    return (states[slot] as { value: unknown }).value;
  },
  useCallback(callback: unknown, deps: readonly unknown[]) { return fakeReact.useMemo(() => callback, deps); },
};
function useFocusEffect(callback: () => () => void) {
  const slot = index++;
  const previous = states[slot] as { callback: typeof callback; cleanup: () => void } | undefined;
  if (previous?.callback === callback) return;
  effects.push(() => { previous?.cleanup(); states[slot] = { callback, cleanup: callback() }; });
}
type Reply = { unreadCount: number; roomId: string };
const calls: { credential: AccountCredential; resolve: (result: Reply) => void; reject: (error: Error) => void }[] = [];
let hook: typeof import('./use-guestbook-status').useGuestbookStatus;
before(async () => {
  modules._load = (request, parent, isMain) => {
    if (request === 'react') return fakeReact;
    if (request === 'expo-router') return { useFocusEffect };
    if (request === './room-api' && parent?.filename.includes('use-guestbook-status')) return {
      createRoomApiClient: ({ credential }: { credential: AccountCredential }) => ({
        ownGuestbook: () => new Promise<Reply>((resolve, reject) => { calls.push({ credential, resolve, reject }); }),
      }),
      roomErrorMessage: (error: Error) => error.message,
    };
    return originalLoad(request, parent, isMain);
  };
  hook = (await import('./use-guestbook-status')).useGuestbookStatus;
});
after(() => { modules._load = originalLoad; });
const onSessionInvalid = async () => {};
function render(credential: AccountCredential) {
  index = 0;
  const value = hook('https://api.test', credential, onSessionInvalid);
  for (const effect of effects.splice(0)) effect();
  return value;
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('unread indicator retains counts through loading/errors, refreshes after reads, and cannot cross credentials', async () => {
  const first: AccountCredential = { kind: 'bearer', sessionToken: 'first' };
  const second: AccountCredential = { kind: 'bearer', sessionToken: 'second' };
  assert.equal(render(first).unreadCount, undefined);
  calls[0]!.resolve({ unreadCount: 3, roomId: 'first-room' });
  await settle();
  let view = render(first);
  assert.equal(view.unreadCount, 3);
  const refresh = view.refresh();
  assert.equal(render(first).unreadCount, 3, 'starting a refresh must not hide the dot');
  calls[1]!.reject(new Error('offline'));
  await refresh;
  view = render(first);
  assert.equal(view.unreadCount, 3, 'a failed fetch must not become zero unread');
  assert.equal(view.error, 'offline');

  notifyGuestbookChanged();
  calls[2]!.resolve({ unreadCount: 1, roomId: 'first-room' });
  await settle();
  assert.equal(render(first).unreadCount, 1, 'post/read events fetch an authoritative count');

  notifyGuestbookChanged();
  view = render(second);
  assert.equal(view.unreadCount, undefined);
  assert.equal(view.roomId, undefined);
  calls[3]!.resolve({ unreadCount: 9, roomId: 'first-room' });
  await settle();
  assert.equal(render(second).unreadCount, undefined, 'late prior-account response is ignored');
  calls[4]!.resolve({ unreadCount: 0, roomId: 'second-room' });
  await settle();
  view = render(second);
  assert.equal(view.unreadCount, 0);
  assert.equal(view.roomId, 'second-room');
  assert.equal(view.error, undefined);

  for (const state of states) if (state && typeof state === 'object' && 'cleanup' in state) (state.cleanup as () => void)();
  const count = calls.length;
  notifyGuestbookChanged();
  assert.equal(calls.length, count, 'blurred screens unsubscribe from updates');
});
