import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';

type Node = { type: string; props: Record<string, any> };
type Loader = (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
const modules = Module as unknown as { _load: Loader };
const original = modules._load;
const hooks: unknown[] = [];
let cursor = 0;
let effects: (() => void)[] = [];
let nextId = 0;
let fail = true;
const messages: { requestId: string; body: string }[] = [];
const meals: { requestId: string; date: string }[] = [];
const react = {
  useState(initial: unknown) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = initial;
    return [hooks[index], (value: unknown) => { hooks[index] = value; }];
  },
  useRef(initial: unknown) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = { current: initial };
    return hooks[index];
  },
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (fn: () => void) => { effects.push(fn); },
};
const jsx = (type: string, props: Record<string, any>): Node => ({ type, props });
modules._load = function (request, parent, isMain) {
  if (request === 'react') return react;
  if (request === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (request === 'react-native') return { Text: 'Text', TextInput: 'TextInput', View: 'View', useColorScheme: () => 'light' };
  if (request === 'expo-router') return { useRouter: () => ({ replace: () => undefined, push: () => undefined }), useLocalSearchParams: () => ({ merchantId: 'shop-1' }) };
  if (request === '@/merchant/use-merchant-catalog') return { useMerchantCatalog: () => ({ merchants: [{ id: 'shop-1', name: '가게', roadAddress: '도로명' }], loading: false }) };
  if (request === '@/merchant/discovery-api') return { createDiscoveryApiClient: () => ({ merchant: async () => ({ id: 'shop-1', business: { state: 'OPEN' } }) }) };
  if (request === '../../../../api/src/real-world-hours') return { businessStateAt: () => ({ state: 'OPEN' }) };
  if (request === '@/social/social-api') return {
    createSocialApiClient: () => ({
      sendMessage: async (input: { requestId: string; body: string }) => { messages.push(input); if (fail) throw Error('lost'); },
      createMealInvitation: async (input: { requestId: string; date: string }) => { meals.push(input); if (fail) throw Error('lost'); },
    }),
    createSocialRequestId: (prefix: string) => `${prefix}:${++nextId}`,
    isHHmm: (value: string) => /^\d\d:\d\d$/.test(value),
    socialErrorMessage: () => '다시 시도',
  };
  if (request === '@/theme/palette') return { colorsForScheme: () => ({ label: '', secondaryLabel: '', separator: '', surface: '', error: '' }) };
  if (request.startsWith('@/ui/')) return { [request.split('/').pop()!.replace(/(^|-)(\w)/g, (_, _hyphen, letter: string) => letter.toUpperCase())]: request.split('/').pop() };
  return original.call(this, request, parent, isMain);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MessageComposeScreen, MealInviteScreen } = require('./compose') as typeof import('./compose');
modules._load = original;

function render(screen: 'message' | 'meal', runEffects = false): Node {
  cursor = 0; effects = [];
  const props = { apiUrl: 'https://example.test', credential: { kind: 'bearer' as const, sessionToken: 'token' }, onSessionInvalid: async () => undefined, friendshipId: 'friend-1' };
  const tree = (screen === 'message' ? MessageComposeScreen(props) : MealInviteScreen(props)) as Node;
  if (runEffects) effects.forEach(effect => effect());
  return tree;
}
function find(node: unknown, predicate: (node: Node) => boolean): Node[] {
  if (Array.isArray(node)) return node.flatMap(item => find(item, predicate));
  if (!node || typeof node !== 'object' || !('type' in node)) return [];
  const entry = node as Node;
  return [...(predicate(entry) ? [entry] : []), ...find(entry.props.children, predicate)];
}
function reset() { hooks.length = 0; cursor = 0; nextId = 0; fail = true; messages.length = 0; meals.length = 0; }
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

test('message retry reuses the ID and changed body creates another', async () => {
  reset();
  let tree = render('message', true);
  find(tree, node => node.type === 'TextInput')[0]!.props.onChangeText('안녕');
  tree = render('message');
  const send = () => find(tree, node => node.props.label === '보내기')[0]!.props.onPress();
  send(); await flush();
  send(); await flush();
  assert.equal(messages[0]!.requestId, messages[1]!.requestId);
  find(tree, node => node.type === 'TextInput')[0]!.props.onChangeText('다시 안녕');
  tree = render('message'); fail = false;
  send(); await flush();
  assert.notEqual(messages[1]!.requestId, messages[2]!.requestId);
});

test('meal retry keeps its ID after selecting the same kind; changed date creates another', async () => {
  reset();
  let tree = render('meal', true);
  await flush(); tree = render('meal');
  find(tree, node => node.props.accessibilityLabel === '초대 날짜')[0]!.props.onChangeText('2026-10-09');
  find(tree, node => node.props.accessibilityLabel === '확정 시간')[0]!.props.onChangeText('12:00');
  tree = render('meal');
  const send = () => find(tree, node => node.props.label === '초대 보내기')[0]!.props.onPress();
  send(); await flush();
  find(tree, node => node.props.label === '확정 시간')[0]!.props.onPress();
  send(); await flush();
  assert.equal(meals[0]!.requestId, meals[1]!.requestId);
  find(tree, node => node.props.accessibilityLabel === '초대 날짜')[0]!.props.onChangeText('2026-10-10');
  tree = render('meal'); fail = false;
  send(); await flush();
  assert.notEqual(meals[1]!.requestId, meals[2]!.requestId);
});
