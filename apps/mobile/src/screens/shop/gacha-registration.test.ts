import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { buildRegistrationPlan } from '../../acquisition/registration-plan';
import type { RegistrationItem } from '../../acquisition/registration-album';
import type { ShopRerollResult } from '../../shop/shop-api';
import * as rules from './gacha-rules';

const source = readFileSync(new URL('./gacha-machine.tsx', import.meta.url), 'utf8');
const result: ShopRerollResult = {
  item: { id: 'friend-a', grade: 'BRONZE', name: '친구' }, balance: 100, replayed: false,
  rewards: {
    mileage: { amount: 5, min: 1, max: 5, probabilityPerAmount: 0.2 },
    clothing: { awarded: true, duplicate: false, item: { id: 'shirt-a', name: '새 옷' }, probability: 0.5 },
    sequence: ['MILEAGE', 'CLOTHING', 'CHARACTER'],
  },
};

test('새 옷은 지급 뒤 보유 목록에 있어도 서버 신규 판정으로 등록 연출을 받는다', () => {
  const album = renderMachine().album();
  const plan = buildRegistrationPlan(album.props.items);
  assert.equal(plan.slots[0]?.status, 'new');
  assert.equal(plan.slots[0]?.isNew, true);
  assert.equal(plan.slots[0]?.sequenceIndex, 0);
});

test('서버가 중복으로 판정한 옷은 새 등록 연출을 받지 않는다', () => {
  const duplicate = { ...result, rewards: { ...result.rewards, clothing: { ...result.rewards.clothing, duplicate: true } } };
  const plan = buildRegistrationPlan(renderMachine('album-registration', duplicate).album().props.items);
  assert.equal(plan.slots[0]?.status, 'duplicate');
  assert.equal(plan.slots[0]?.isNew, false);
  assert.equal(plan.slots[0]?.sequenceIndex, null);
});

test('복구된 옷은 서버 신규 플래그가 남아 있어도 보유 확인으로 보여준다', () => {
  const plan = buildRegistrationPlan(renderMachine('album-registration', { ...result, replayed: true }).album().props.items);
  assert.equal(plan.slots[0]?.status, 'owned');
  assert.equal(plan.slots[0]?.isNew, false);
});

test('확인 완료 버튼 뒤 같은 영수증 등록 화면을 다시 열면 보유 확인만 한다', () => {
  const machine = renderMachine();
  machine.album().props.onDone();
  assert.equal(machine.phase(), 'result');
  const tree = machine.render();
  const reopen = controls(tree).find((node) => node.props.label === '등록 결과 다시 보기');
  assert.ok(reopen);
  press(reopen);
  const plan = buildRegistrationPlan(machine.album().props.items);
  assert.equal(machine.phase(), 'album-registration');
  assert.equal(plan.newCount, 0);
  assert.ok(plan.slots.every((slot) => slot.status === 'owned'));
});

test('옷이 없는 결과는 캐릭터만 등록 항목으로 전달한다', () => {
  const noClothing = { ...result, rewards: { ...result.rewards, clothing: { ...result.rewards.clothing, awarded: false, item: null } } };
  const items = renderMachine('album-registration', noClothing).album().props.items;
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, 'character:friend-a');
});

test('등록 화면 헤더는 개봉 건너뛰기를 숨기고 실제 닫기 버튼은 보상 공개를 다시 시작하지 않는다', () => {
  const machine = renderMachine();
  const header = controls(machine.render())[0]!;
  press(header);
  assert.equal(machine.phase(), 'album-registration');
  assert.equal(machine.closeCount(), 1);
  assert.equal(header.props.label, '닫기');
  assert.equal(controls(machine.render()).some((node) => node.props.label === '건너뛰기'), false);
});

test('개봉 중 실제 헤더 건너뛰기 버튼은 첫 보상 공개로 이동한다', () => {
  const machine = renderMachine('crank');
  const header = controls(machine.render())[0]!;
  assert.equal(header.props.label, '건너뛰기');
  press(header);
  assert.equal(machine.phase(), 'reward-mileage');
  assert.equal(machine.closeCount(), 0);
});

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
type Album = Element & { props: { items: RegistrationItem[]; onDone: () => void } };

function controls(tree: unknown): Element[] {
  if (!tree || typeof tree !== 'object') return [];
  const node = tree as Element;
  return [...(typeof node.type === 'function' && node.type.name === 'Control' ? [node] : []),
    ...(node.children ?? []).flatMap(controls)];
}

function press(control: Element) {
  // Execute Control too, so the assertion invokes the handler wired to the real Pressable.
  const button = (control.type as (props: Element['props']) => Element)(control.props);
  assert.equal(button.type, 'Pressable');
  button.props.onPress();
}

function renderMachine(initialPhase: rules.GachaPhase = 'album-registration', award = result) {
  const states: unknown[] = [initialPhase];
  let cursor = 0;
  let closeCount = 0;
  const react = {
    createElement: (type: unknown, props: Element['props'], ...children: unknown[]) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value: unknown) => { states[index] = value; }];
    },
    useRef: (initial: unknown) => ({ current: initial === 'detail' ? states[0] : initial }),
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useEffect: () => undefined,
  };
  const modules: Record<string, unknown> = {
    react,
    'expo-router': { useFocusEffect: () => undefined },
    'react-native': { Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'react-native-reanimated': { useAnimatedStyle: () => ({}), useSharedValue: (value: number) => ({ get: () => value, set: () => undefined }) },
    '@/motion/use-motion': { useMotionEnabled: () => true },
    '@/sound/ui-sounds': { useDrawMusic: () => undefined, playUiSound: () => undefined },
    '@/gamification/native-effects': { drawHaptic: () => Promise.resolve() },
    '@/acquisition/registration-album': { RegistrationAlbum: 'RegistrationAlbum' },
    '@/shop/wardrobe': { equippedClothingArt: () => null },
    './gacha-rules': rules,
  };
  const context = { exports: {} as { GachaMachine: (props: unknown) => Element }, React: react, clearTimeout,
    require: (name: string) => modules[name] ?? {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText, context);
  const render = () => {
    cursor = 0;
    return context.exports.GachaMachine({
      snapshot: {
        mileage: { balance: 100 }, grades: [{ grade: 'BRONZE', price: 10, total: 2 }], items: [],
        clothing: { equipped: null, items: [{ id: 'shirt-a', name: '새 옷', owned: true }] },
      },
      result: award, selectedGrade: 'BRONZE', ownedBefore: [], receiptId: 'receipt-a', busy: false, avatarBusy: false,
      onClose: () => { closeCount++; },
    });
  };
  const album = (): Album => {
    const find = (node: Element): Element | undefined => node.type === 'RegistrationAlbum' ? node
      : node.children.filter((child): child is Element => !!child && typeof child === 'object').map(find).find(Boolean);
    const node = find(render());
    assert.ok(node, '등록 화면을 렌더해야 한다');
    return node as Album;
  };
  return { render, album, phase: () => states[0], closeCount: () => closeCount };
}
