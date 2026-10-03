import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import type { OpenedReward, Reward } from './badge-api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// 네이티브 화면 없이 실제 컴포넌트의 버튼과 비동기 완료 경로를 실행한다.
function rewardBoxHarness(onOpen: () => Promise<OpenedReward>) {
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const sounds: string[] = [];
  let cursor = 0;
  let dirty = false;
  let disposed = false;
  let updatesAfterDispose = 0;
  const react = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next: any) => {
        if (disposed) updatesAfterDispose++;
        slots[index] = typeof next === 'function' ? next(slots[index]) : next;
        dirty = true;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useLayoutEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && deps.every((value, i) => value === previous.deps[i])) return;
      const slot = slots[index] = { deps, cleanup: undefined as (() => void) | undefined };
      effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect() || undefined; });
    },
  };
  const jsx = (type: unknown, props: any) => ({ type, props });
  const styles = new Proxy({}, { get: () => ({}) });
  const mocks: Record<string, unknown> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View' },
    'react-native-reanimated': { useReducedMotion: () => true },
    '@/sound/ui-sounds': { playUiSound: (sound: string) => sounds.push(sound) },
    './badge-api': { BadgeApiError: class BadgeApiError extends Error {} },
    './badge-rules': {
      openRewardErrorMessage: () => '실패', rewardAccessibilityLabel: () => '상자',
      rewardBoxName: () => '상자', rewardStatusText: () => '준비',
    },
    './gift-box': { GiftBox: 'GiftBox' },
    './native-effects': { lightHaptic: async () => {} },
    './theme': { useGamificationTheme: () => ({ styles, medal: {}, palette: { primary: '#000' } }) },
  };
  const exports: any = {};
  const source = readFileSync(new URL('./reward-box.tsx', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name: string) => mocks[name], setTimeout });
  const reward: Reward = { milestone: 1, requiredTiers: 1, state: 'READY', offer: null, coupon: null };
  const revealed: OpenedReward[] = [];
  const failed: (string | undefined)[] = [];
  const props = { reward, earnedTiers: 1, onOpen, onRevealed: (value: OpenedReward) => revealed.push(value), onOpenFailed: (code: string | undefined) => failed.push(code) };
  function render() {
    let tree: any;
    do { cursor = 0; dirty = false; tree = exports.RewardBoxCard(props); } while (dirty);
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  function findButton(node: any): any {
    if (!node) return undefined;
    if (Array.isArray(node)) return node.map(findButton).find(Boolean);
    if (node.type === 'Pressable') return node;
    return findButton(node.props?.children);
  }
  return {
    press() { findButton(render()).props.onPress(); },
    changeOpen(next: () => Promise<OpenedReward>) { props.onOpen = next; render(); },
    dispose() { disposed = true; slots.forEach((slot) => slot?.cleanup?.()); },
    revealed, failed, sounds,
    get updatesAfterDispose() { return updatesAfterDispose; },
  };
}

const opened: OpenedReward = {
  coupon: {
    milestone: 1, couponId: 'coupon-1', merchantId: 'store-1', merchantName: '가게', title: '쿠폰',
    detail: '안내', status: 'ISSUED', issuedAt: '2026-10-03T00:00:00.000Z',
    expiresAt: '2026-10-04T00:00:00.000Z', redeemedAt: null,
  },
  replayed: false,
};
const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); await Promise.resolve(); };

test('보상 상자가 사라진 뒤 A의 완료·실패는 콜백과 상태를 바꾸지 않는다', async () => {
  const success = deferred<OpenedReward>();
  const oldBox = rewardBoxHarness(() => success.promise);
  oldBox.press();
  oldBox.dispose();
  const currentBox = rewardBoxHarness(async () => opened);
  currentBox.press();
  success.resolve(opened);
  await settle();
  assert.deepEqual(oldBox.revealed, []);
  assert.deepEqual(oldBox.failed, []);
  assert.equal(oldBox.updatesAfterDispose, 0);
  assert.deepEqual(currentBox.revealed, [opened]);

  const failure = deferred<OpenedReward>();
  const failedBox = rewardBoxHarness(() => failure.promise);
  failedBox.press();
  failedBox.dispose();
  failure.reject(new Error('A 실패'));
  await settle();
  assert.deepEqual(failedBox.failed, []);
  assert.deepEqual(failedBox.sounds, ['open']);
  assert.equal(failedBox.updatesAfterDispose, 0);
  currentBox.dispose();
});

test('상자 인스턴스의 API가 바뀌어도 이전 응답은 새 콜백에 도달하지 않는다', async () => {
  const oldResponse = deferred<OpenedReward>();
  let newCalls = 0;
  const box = rewardBoxHarness(() => oldResponse.promise);
  box.press();
  box.changeOpen(async () => { newCalls++; return opened; });
  assert.equal(newCalls, 0);
  box.press();
  oldResponse.resolve(opened);
  await settle();
  assert.equal(newCalls, 1);
  assert.deepEqual(box.revealed, [opened]);
  assert.deepEqual(box.failed, []);
  box.dispose();
});
