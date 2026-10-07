import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createMemoryHistory } = require('expo-router/build/fork/createMemoryHistory');

/**
 * 하위 화면에서 하단 탭(dismissTo)으로 가면 Stack이 줄어든다. expo-router 웹 history는 줄어든 만큼 `history.go(-n)` 한 뒤 앞 항목을 새 경로로
 * 덮어써서(replace), 앱의 이전 화면이 기록에서 사라지고 뒤로 가기가 앱 밖으로 나갔다. 패치는 "이전 항목 중 같은 경로가 없으면" push로 바꾼다.
 */
test('a popped-to path that no earlier entry holds is told apart from a real step back', () => {
  const previous = { window: Reflect.get(globalThis, 'window'), location: Reflect.get(globalThis, 'location') };
  const browser = { state: null as unknown, pushState(state: unknown) { this.state = state; }, replaceState(state: unknown) { this.state = state; } };
  Reflect.set(globalThis, 'window', { history: browser, addEventListener() {}, removeEventListener() {}, document: { title: '' } });
  Reflect.set(globalThis, 'location', { hash: '' });
  try {
    const history = createMemoryHistory();
    history.replace({ path: '/play/', state: 'home' });
    history.push({ path: '/play/room-explore', state: 'room-explore' });
    // 탐색 탭: 이전 항목(/play/)과 경로가 다르다 → 새 목적지(push).
    assert.equal(history.backIndex({ path: '/play/search' }), -1);
    // 홈 탭: 이전 항목과 같은 경로 → 뒤로 가기(go)로 처리한다.
    assert.equal(history.backIndex({ path: '/play/' }), 0);
  } finally {
    Reflect.set(globalThis, 'window', previous.window);
    Reflect.set(globalThis, 'location', previous.location);
  }
});

test('the installed expo-router web history pushes instead of overwriting the previous screen, and the patch is pinned to that version', () => {
  const installed = readFileSync(require.resolve('expo-router/build/fork/useLinking.js'), 'utf8');
  assert.match(installed, /if \(nextIndex === -1\) \{\s*history\.push\(\{ path, state \}\);\s*return;\s*\}/);
  // The push comes before the go-back branch, so a back step to a known path is unchanged.
  assert.ok(installed.indexOf('if (nextIndex === -1)') < installed.indexOf('await history.go(historyDelta)'));
  const version = JSON.parse(readFileSync(require.resolve('expo-router/package.json'), 'utf8')).version;
  const patch = readFileSync(fileURLToPath(new URL(`../../patches/expo-router+${version}.patch`, import.meta.url)), 'utf8');
  assert.match(patch, /node_modules\/expo-router\/build\/fork\/useLinking\.js/);
  assert.match(patch, /\+\s+if \(nextIndex === -1\) \{/);
  // The go-back branch looks up the target by absolute index (upstream passed the negative offset, so it never ran), and the hash is ignored when matching.
  assert.match(installed, /history\.get\(nextIndex\)\) \{/);
  assert.match(patch, /\+\s+history\.get\(nextIndex\)\) \{/);
  assert.match(patch, /node_modules\/expo-router\/build\/fork\/createMemoryHistory\.js/);
  assert.match(patch, /\+\s+if \(item\.path\.split\('#'\)\[0\] === path\.split\('#'\)\[0\]\) \{/);
  // A browser back/forward popstate resyncs the memory-history index (as go() does) before the listener runs.
  assert.match(patch, /\+\s+index = Math\.max\(items\.findIndex\(\(item\) => item\.id === window\.history\.state\?\.id\), 0\);/);
});

// ---- 패치된 useLinking.js를 실제 createMemoryHistory·가짜 브라우저 history 위에서 실행하는 시나리오 시험 ----
// useLinking.js는 react-native를 끌어와 Node에서 직접 불러올 수 없으므로, 설치본 소스를 그대로 읽어 react·react-navigation 쪽 의존만 가짜로 갈아 끼운다.

type Route = { key: string; name: string; state?: Nav };
type Nav = { key: string; index: number; routes: Route[]; history?: { type: string; key: string }[] };

const tabNames = ['search', 'collection', 'index', 'play-tab', 'shop'];
const screenPaths: Record<string, string> = { index: '/play/', search: '/play/search', 'room-explore': '/play/room-explore', studio: '/play/studio' };

/** 루트 Stack: (tabs) 탭 네비게이터(방문 순서 tabHistory, 마지막이 현재 탭) 위에 하위 화면 above를 쌓은 상태. */
function app(tabHistory: string[], ...above: string[]): Nav {
  const tabs: Nav = { key: 'tabs', index: tabNames.indexOf(tabHistory.at(-1)!), routes: tabNames.map((name) => ({ key: name, name })),
    history: tabHistory.map((name) => ({ type: 'route', key: name })) };
  const routes: Route[] = [{ key: 'tabs-route', name: '(tabs)', state: tabs }, ...above.map((name) => ({ key: name, name }))];
  return { key: 'stack', index: routes.length - 1, routes };
}
const focused = (nav: Nav): Route => { const route = nav.routes[nav.index]!; return route.state ? focused(route.state) : route; };
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

/** 주소 줄·뒤로/앞으로를 흉내 내는 최소 브라우저: pushState는 앞쪽 기록을 지우고, go(n)은 popstate를 비동기로 낸다. */
function createBrowser(startUrl: string) {
  const entries: { state: unknown; url: string }[] = [{ state: null, url: startUrl }];
  let index = 0;
  const popstate = new Set<() => void>();
  const parsed = () => new URL(entries[index]!.url, 'http://localhost');
  const location = { get pathname() { return parsed().pathname; }, get search() { return parsed().search; }, get hash() { return parsed().hash; } };
  const history = {
    get state() { return entries[index]!.state; },
    pushState(state: unknown, _title: string, url: string) { entries.splice(index + 1, entries.length, { state, url }); index += 1; },
    replaceState(state: unknown, _title: string, url: string) { entries[index] = { state, url }; },
    go(delta: number) {
      if (index + delta < 0 || index + delta >= entries.length) return;
      index += delta;
      setTimeout(() => [...popstate].forEach((listener) => listener()), 0);
    },
  };
  const window = { history, location, document: { title: '' },
    addEventListener(type: string, listener: () => void) { if (type === 'popstate') popstate.add(listener); },
    removeEventListener(type: string, listener: () => void) { if (type === 'popstate') popstate.delete(listener); } };
  return { window, location, urls: () => entries.map((entry) => entry.url), get index() { return index; },
    async step(delta: number) { history.go(delta); await settle(); } };
}

/** 브라우저 위에서 설치된 useLinking을 돌리고 scenario(navigate)에 넘긴다. navigate(next)는 앱 네비게이션 상태가 next로 바뀐 것을 알린다. */
async function withSession(startUrl: string, initial: Nav, scenario: (session: {
  browser: ReturnType<typeof createBrowser>; navigate: (next: Nav) => Promise<void>; current: () => Nav;
  history: { get(index: number): { path: string } | undefined; readonly index: number };
}) => Promise<void>) {
  const previous = { window: Reflect.get(globalThis, 'window'), location: Reflect.get(globalThis, 'location') };
  const browser = createBrowser(startUrl);
  Reflect.set(globalThis, 'window', browser.window);
  Reflect.set(globalThis, 'location', browser.location);
  const cleanups: unknown[] = [];
  try {
    const store = { state: initial as Nav | undefined };
    const container = {
      state: initial as Nav | undefined, listener: () => {},
      getRootState() { return this.state; },
      addListener(_type: string, listener: () => void) { this.listener = listener; return () => {}; },
      resetRoot(next: Nav | undefined) { if (!next) throw new Error('unexpected deep link'); this.update(next); },
      dispatch() { throw new Error('unexpected action'); },
      update(next: Nav) { this.state = next; store.state = next; this.listener(); },
    };
    const effects: (() => unknown)[] = [];
    let memory: unknown;
    const react = { useEffect: (effect: () => unknown) => { effects.push(effect); }, useState: (init: () => unknown) => [memory = init()],
      useRef: (value: unknown) => ({ current: value }), useCallback: (fn: unknown) => fn, use: () => undefined };
    const pathOf = (nav: Nav) => screenPaths[focused(nav).name]!;
    // 기록에 상태가 없는 항목(앞으로 가기 등)은 경로로 상태를 만든다 — 실제 앱의 getStateFromPath 역할.
    const stateOf = (path: string) => ({ '/play/': app(['index']), '/play/search': app(['index', 'search']),
      '/play/room-explore': app(['index', 'search'], 'room-explore'), '/play/studio': app(['index'], 'studio') })[path.split('#')[0]!];
    const stubs: Record<string, unknown> = {
      react,
      '../global-state/serverLocationContext': { ServerContext: {} },
      '../global-state/storeContext': { useExpoRouterStore: () => store },
      '../global-state/utils': { getRootStackRouteNames: () => ['(tabs)', 'room-explore', 'studio'] },
      './getPathFromState': { appendBaseUrl: (path: string) => path },
      '../react-navigation/native': { useNavigationIndependentTree: () => false, findFocusedRoute: focused },
    };
    const file = require.resolve('expo-router/build/fork/useLinking.js');
    const fork = createRequire(file);
    const module = { exports: {} as { useLinking: (...args: unknown[]) => unknown } };
    new Function('exports', 'require', 'module', readFileSync(file, 'utf8'))(module.exports,
      (id: string) => (id in stubs ? stubs[id] : fork(id)), module);
    module.exports.useLinking({ current: container },
      { config: {}, getStateFromPath: stateOf, getPathFromState: pathOf, getActionFromState: () => undefined }, () => {});
    for (const effect of effects) cleanups.push(effect());
    await settle();
    await scenario({ browser, history: memory as Parameters<Parameters<typeof withSession>[2]>[0]['history'], current: () => container.state!,
      navigate: async (next) => { container.update(next); await settle(); } });
  } finally {
    for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();
    Reflect.set(globalThis, 'window', previous.window);
    Reflect.set(globalThis, 'location', previous.location);
  }
}

test('a neighbour room followed by another tab keeps the room behind it, and browser back returns to the room', async () => {
  await withSession('/play/', app(['index']), async ({ browser, navigate, current }) => {
    await navigate(app(['index'], 'room-explore'));
    await navigate(app(['index', 'search'])); // 컨텍스트 바의 탐색: 이전 항목에 같은 경로가 없다 → push
    assert.deepEqual(browser.urls(), ['/play/', '/play/room-explore', '/play/search']);
    await browser.step(-1);
    assert.equal(browser.location.pathname, '/play/room-explore');
    assert.equal(focused(current()).name, 'room-explore');
    assert.deepEqual(browser.urls(), ['/play/', '/play/room-explore', '/play/search']);
  });
});

test('the context bar home tab after tab -> neighbour room goes back to the existing home entry without overwriting the tab entry', async () => {
  await withSession('/play/', app(['index']), async ({ browser, navigate, current }) => {
    await navigate(app(['index', 'search']));
    await navigate(app(['index', 'search'], 'room-explore'));
    await navigate(app(['search', 'index'])); // 컨텍스트 바의 홈
    // 탐색 항목이 홈으로 덮이면 [/, /, room-explore]가 되어 첫 브라우저 뒤로가 같은 화면에 머문다.
    assert.deepEqual(browser.urls(), ['/play/', '/play/search', '/play/room-explore']);
    assert.equal(browser.index, 0);
    await browser.step(1);
    assert.equal(browser.location.pathname, '/play/search');
    assert.equal(focused(current()).name, 'search');
  });
});

test('header back from a session entered with a URL hash does not grow the browser history', async () => {
  await withSession('/play/#invite', app(['index']), async ({ browser, navigate }) => {
    for (let round = 0; round < 3; round += 1) {
      await navigate(app(['index'], 'studio'));
      await navigate(app(['index']));
      assert.equal(browser.urls().length, 2, `round ${round + 1}`);
      assert.equal(browser.index, 0);
    }
    assert.deepEqual(browser.urls(), ['/play/', '/play/studio']);
  });
});

test('existing flows keep working: header back, same-tab reselect, deep link entry and consecutive back/forward', async () => {
  await withSession('/play/', app(['index']), async ({ browser, navigate, current }) => {
    // 헤더 뒤로: 하위 화면을 열었다 닫으면 같은 두 항목, 현재 위치는 앞 항목.
    await navigate(app(['index'], 'studio'));
    await navigate(app(['index']));
    assert.deepEqual(browser.urls(), ['/play/', '/play/studio']);
    assert.equal(browser.index, 0);
    // 같은 탭 재선택: 기록이 늘지 않는다.
    await navigate(app(['index', 'search']));
    await navigate(app(['index', 'search']));
    assert.deepEqual(browser.urls(), ['/play/', '/play/search']);
    // 연속 뒤로/앞으로: 항목 수는 그대로, 화면은 기록과 같다.
    await navigate(app(['index', 'search'], 'room-explore'));
    for (const [delta, name] of [[-1, 'search'], [-1, 'index'], [1, 'search'], [1, 'room-explore']] as const) {
      await browser.step(delta);
      assert.equal(focused(current()).name, name);
      assert.equal(browser.location.pathname, screenPaths[name]);
      assert.equal(browser.urls().length, 3);
    }
  });
  // 딥링크로 들어온 화면에서 탭으로 가면 딥링크 화면이 뒤에 남는다.
  await withSession('/play/room-explore', app(['index'], 'room-explore'), async ({ browser, navigate, current }) => {
    await navigate(app(['index']));
    assert.deepEqual(browser.urls(), ['/play/room-explore', '/play/']);
    await browser.step(-1);
    assert.equal(focused(current()).name, 'room-explore');
  });
});

test('after browser back the memory history index follows the popped entry, so the next navigation drops the forward entry instead of overwriting a stale one', async () => {
  await withSession('/play/', app(['index']), async ({ browser, history, navigate, current }) => {
    await navigate(app(['index', 'search'])); // B
    await navigate(app(['index', 'search'], 'room-explore')); // C
    await browser.step(-1); // 브라우저 뒤로 가기: go() 없이 popstate만 온다 → 메모리 기록의 index가 B를 가리켜야 한다.
    assert.equal(focused(current()).name, 'search');
    assert.equal(history.index, 1);
    await navigate(app(['index', 'search'], 'studio')); // D
    // 브라우저 기록: C 자리를 D가 대체한다.
    assert.deepEqual(browser.urls(), ['/play/', '/play/search', '/play/studio']);
    // 메모리 기록도 같다: A, B 그대로, C가 있던 자리에 D, 현재 index는 D. (index가 낡으면 [A, B, B, D]가 되어 어긋난다.)
    assert.deepEqual([0, 1, 2, 3].map((position) => history.get(position)?.path), ['/play/', '/play/search', '/play/studio', undefined]);
    assert.equal(history.index, 2);
  });
});
