import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';

type Node = { type: string; props: Record<string, any> };
type Loader = (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
const modules = Module as unknown as { _load: Loader };
const original = modules._load;
const states: unknown[] = [];
let cursor = 0;
let effects: (() => void)[] = [];
let fail = true;
const preferences = { pushEnabled: false, rewardAvailable: true, couponExpiring: true, campaignExpiring: true };
const client = {
  list: async () => { if (fail) throw Error('offline'); return []; },
  preferences: async () => { if (fail) throw Error('offline'); return preferences; },
};
const fakeReact = {
  useState(initial: unknown) {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (value: unknown) => { states[index] = typeof value === 'function' ? (value as (previous: unknown) => unknown)(states[index]) : value; }];
  },
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => { effects.push(fn); },
};
const jsx = (type: string, props: Record<string, any>): Node => ({ type, props });
modules._load = function (request, parent, isMain) {
  if (request === 'react') return fakeReact;
  if (request === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (request === 'react-native') return { ActivityIndicator: 'ActivityIndicator', Linking: {}, Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch', Text: 'Text', View: 'View', useColorScheme: () => 'light' };
  if (request === 'expo-router') return { useRouter: () => ({ push: () => undefined }) };
  if (request === '@/theme/palette') return { colorsForScheme: () => ({ label: '', secondaryLabel: '', primary: '', surface: '', error: '' }) };
  if (request === './api') return { NotificationApiClient: class { constructor() { return client; } } };
  if (request === './native') return {};
  if (request === './navigation') return { notificationTarget: () => undefined };
  return original.call(this, request, parent, isMain);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NotificationCenter } = require('./center') as typeof import('./center');
modules._load = original;

function render(runEffect = false): Node {
  cursor = 0; effects = [];
  const tree = NotificationCenter({ apiUrl: 'https://example.test', credential: { kind: 'bearer', sessionToken: 'token' } }) as Node;
  if (runEffect) effects.forEach(effect => effect());
  return tree;
}
function find(node: unknown, predicate: (node: Node) => boolean): Node[] {
  if (Array.isArray(node)) return node.flatMap(item => find(item, predicate));
  if (!node || typeof node !== 'object' || !('type' in node)) return [];
  const entry = node as Node;
  return [...(predicate(entry) ? [entry] : []), ...find(entry.props.children, predicate)];
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

test('failed notification load clears spinner and hides empty; retry restores successful empty', async () => {
  let tree = render(true);
  assert.equal(find(tree, node => node.type === 'ActivityIndicator').length, 1);
  await flush();
  tree = render();
  assert.equal(find(tree, node => node.type === 'ActivityIndicator').length, 0);
  assert.equal(find(tree, node => node.type === 'Text' && node.props.children === '아직 알림이 없습니다.').length, 0);
  const retry = find(tree, node => node.type === 'Pressable' && node.props.accessibilityRole === 'button')[0];
  assert.ok(retry);
  fail = false;
  retry.props.onPress();
  await flush();
  tree = render();
  assert.equal(find(tree, node => node.type === 'Text' && node.props.children === '아직 알림이 없습니다.').length, 1);
  assert.equal(find(tree, node => node.type === 'ActivityIndicator').length, 0);
  assert.deepEqual(find(tree, node => node.type === 'Switch').map(node => node.props.accessibilityLabel), [
    '휴대폰 푸시 알림 받기', '받을 수 있는 방문 보상', '쿠폰 만료', '점주 캠페인 만료',
  ]);
});
