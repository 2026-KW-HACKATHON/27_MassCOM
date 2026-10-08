import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';
import { mealToday } from './meal-picker-state';

type Element = { props: Record<string, any> };
type Loader = (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
const modules = Module as unknown as { _load: Loader };
const original = modules._load;
const hooks: unknown[] = [];
let cursor = 0;
const jsx = (type: unknown, props: Element['props']) => ({ type, props });
modules._load = function (request, parent, isMain) {
  if (request === 'react') return {
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value: unknown) => { hooks[index] = value; }];
    },
    useMemo: (fn: () => unknown) => fn(),
  };
  if (request === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
  if (request === 'react-native') return { View: 'View' };
  if (request === '@/motion/use-motion') return { useMotionEnabled: () => false };
  if (request === '@/theme/palette') return {};
  if (request === '@/theme/world') return {};
  if (request === '@/theme/ui-metrics') return {};
  if (request === '@/ui/bounce-button') return { BounceButton: 'BounceButton' };
  return original.call(this, request, parent, isMain);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MealDatePicker, MealTimePicker } = require('./meal-date-time-picker') as typeof import('./meal-date-time-picker');
modules._load = original;

function parts(element: unknown): Element[] { return (element as Element).props.children.filter(Boolean); }

test('opening and cancelling date selection never silently fills an empty draft', () => {
  hooks.length = 0;
  const selected: string[] = [];
  const render = () => { cursor = 0; return parts(MealDatePicker({ label: '날짜', value: '', onChange: value => selected.push(value) })); };
  let fields = render();
  assert.equal(fields.length, 1);
  fields[0]!.props.onPress(); fields = render();
  assert.equal(selected.length, 0);
  fields[1]!.props.onCancel(); fields = render();
  assert.equal(fields.length, 1);
  assert.equal(selected.length, 0);
  fields[0]!.props.onPress(); fields = render();
  fields[1]!.props.onConfirm();
  assert.deepEqual(selected, [mealToday()]);
});

test('receiver wheel clamps minutes to the allowed hour and commits only after confirmation', () => {
  hooks.length = 0;
  const selected: string[] = [];
  const render = () => { cursor = 0; return parts(MealTimePicker({ label: '수락할 시간', value: '', minTime: '12:58', maxTime: '13:01', onChange: value => selected.push(value) })); };
  let fields = render();
  fields[0]!.props.onPress(); fields = render();
  assert.equal(fields[1]!.props.selected, '12:58');
  assert.equal(selected.length, 0);
  const wheels = () => fields[1]!.props.children.props.children as Element[];
  wheels()[0]!.props.onChange('13'); fields = render();
  assert.equal(fields[1]!.props.selected, '13:00');
  assert.deepEqual(wheels()[1]!.props.options.map((option: { value: string }) => option.value), ['00', '01']);
  wheels()[1]!.props.onChange('01'); fields = render();
  assert.equal(selected.length, 0);
  fields[1]!.props.onConfirm();
  assert.deepEqual(selected, ['13:01']);
});
