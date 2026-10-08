import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';

const source = readFileSync(new URL('./registration-album.tsx', import.meta.url), 'utf8');

test('RegistrationAlbum stays embeddable and leaves scrolling/modal ownership to callers', () => {
  assert.doesNotMatch(source, /\bModal\b/);
  assert.doesNotMatch(source, /\bScrollView\b/);
  assert.match(source, /export function RegistrationAlbum/);
});

test('skip only settles animations and never calls the dismiss callback', () => {
  const body = source.match(/const skip = \(\) => \{(?<body>[\s\S]*?)\n  \};/)?.groups?.body;
  assert.ok(body);
  assert.match(body, /setSettledReceiptId\(receiptId\)/);
  assert.doesNotMatch(body, /onDone\(/);
  assert.doesNotMatch(body, /onOpenCollection\(/);
});

test('final action labels match the shared reward-registration contract', () => {
  assert.match(source, /collectionLabel = '도감에서 보기'/);
  assert.match(source, /label="확인 완료"/);
});

test('new slot animation is sequential and bounded by receipt item identity', () => {
  assert.match(source, /SLOT_DELAY_MS = 150/);
  assert.match(source, /slot\.sequenceIndex/);
  assert.match(source, /playedKey\.current === animationKey/);
  assert.match(source, /cancelAnimation\(scale\)/);
  assert.match(source, /useMotionEnabled\(\)/);
});

test('compact album uses one column for high font scale even on a 390dp screen', () => {
  const context = { exports: {} as Record<string, unknown>, require: stubRequire() };
  runInNewContext(ts.transpileModule(`
    ${source}
    exports.compact320 = shouldUseCompactAlbum(320, 1);
    exports.compact390LargeText = shouldUseCompactAlbum(390, 2);
    exports.regular390 = shouldUseCompactAlbum(390, 1.3);
  `, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText, context);

  assert.equal(context.exports.compact320, true);
  assert.equal(context.exports.compact390LargeText, true);
  assert.equal(context.exports.regular390, false);
});

test('StrictMode effect replay settles a new slot instead of leaving it hidden after cleanup', () => {
  const fixed = runStrictModeReplay(source);
  assert.deepEqual(fixed.afterFirstCleanup, [0.64, 0, 1.45, 0]);
  assert.deepEqual(fixed.afterSecondSetup, [1, 1, 1, 1]);

  const oldGuardSource = source.replace(
    /if \(playedKey\.current === animationKey\) \{\n      scale\.set\(1\);\n      opacity\.set\(1\);\n      stampScale\.set\(1\);\n      stampOpacity\.set\(1\);\n      return undefined;\n    \}/,
    'if (playedKey.current === animationKey) return undefined;',
  );
  assert.notEqual(oldGuardSource, source);
  const oldGuard = runStrictModeReplay(oldGuardSource);
  assert.deepEqual(oldGuard.afterFirstCleanup, [0.64, 0, 1.45, 0]);
  assert.deepEqual(oldGuard.afterSecondSetup, [0.64, 0, 1.45, 0]);
});

test('TSX markup includes ownership guidance and no NEW stamp for non-new slots', () => {
  assert.match(source, /이번에 얻은 수집품은 도감이나 내 공간에서 다시 볼 수 있어요/);
  assert.match(source, /\{slot\.isNew \? '등록' : '확인'\}/);
});

test('props type exports the agreed caller interface', () => {
  const context = { exports: {} as Record<string, unknown>, require: () => ({}) };
  runInNewContext(ts.transpileModule(`
    ${source}
    exports.hasReceiptId = /receiptId: string/.test(sourceText);
    exports.hasArtworkNode = /artwork: ReactNode/.test(sourceText);
  `, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText, { ...context, sourceText: source });
  assert.equal(context.exports.hasReceiptId, true);
  assert.equal(context.exports.hasArtworkNode, true);
});

function runStrictModeReplay(sourceText: string) {
  const effects: (() => undefined | (() => void))[] = [];
  const sharedValues: SharedValueStub[] = [];
  const context = {
    exports: {} as Record<string, unknown>,
    React: { createElement: () => null },
    require: stubRequire({
      react: {
        useEffect: (effect: () => undefined | (() => void)) => { effects.push(effect); },
        useMemo: (factory: () => unknown) => factory(),
        useRef: <T,>(value: T) => ({ current: value }),
        useState: <T,>(value: T) => [value, () => undefined],
      },
      'react-native-reanimated': {
        default: { View: 'Animated.View' },
        cancelAnimation: (value: SharedValueStub) => { value.pending = undefined; },
        Easing: { out: () => 'ease', cubic: 'cubic' },
        useAnimatedStyle: () => ({}),
        useSharedValue: (value: number) => {
          const shared: SharedValueStub = {
            value,
            pending: undefined,
            set(next: number | AnimationDescriptor) {
              if (typeof next === 'number') this.value = next;
              else this.pending = next;
            },
          };
          sharedValues.push(shared);
          return shared;
        },
        withDelay: (delay: number, value: AnimationDescriptor) => ({ kind: 'delay', delay, value }),
        withSequence: (...values: AnimationDescriptor[]) => ({ kind: 'sequence', values }),
        withSpring: (value: number) => ({ kind: 'spring', value }),
        withTiming: (value: number) => ({ kind: 'timing', value }),
      },
      '@/motion/use-motion': { useMotionEnabled: () => true },
    }),
  };

  runInNewContext(ts.transpileModule(`
    ${sourceText}
    RegistrationAlbumSlot({
      slot: {
        id: 'coin-a',
        name: '긴 이름 코인',
        kindLabel: '가게 코인',
        status: 'new',
        isNew: true,
        sequenceIndex: 0,
        statusLabel: 'NEW',
        confirmation: '이번에 얻은 가게 코인이에요.',
      },
      artwork: null,
      settleAll: false,
    });
  `, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText, context);

  assert.equal(effects.length, 1);
  const cleanup = effects[0]!();
  cleanup?.();
  const afterFirstCleanup = sharedValues.map((value) => value.value);
  effects[0]!();
  const afterSecondSetup = sharedValues.map((value) => value.value);
  return { afterFirstCleanup, afterSecondSetup };
}

type AnimationDescriptor = {
  kind: string;
  value?: number | AnimationDescriptor;
  values?: AnimationDescriptor[];
  delay?: number;
};

type SharedValueStub = {
  value: number;
  pending: AnimationDescriptor | undefined;
  set(next: number | AnimationDescriptor): void;
};

function stubRequire(overrides: Record<string, unknown> = {}) {
  return (request: string) => {
    if (request in overrides) return overrides[request];
    if (request === 'react') return { useEffect: () => undefined, useMemo: (factory: () => unknown) => factory(), useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, () => undefined] };
    if (request === 'react-native') return { Pressable: 'Pressable', StyleSheet: { hairlineWidth: 1 }, Text: 'Text', View: 'View', useColorScheme: () => 'light', useWindowDimensions: () => ({ width: 390, fontScale: 1 }) };
    if (request === 'react-native-reanimated') return { default: { View: 'Animated.View' }, cancelAnimation: () => undefined, Easing: { out: () => 'ease', cubic: 'cubic' }, useAnimatedStyle: () => ({}), useSharedValue: (value: number) => ({ value, set(next: number) { this.value = next; } }), withDelay: (_delay: number, value: number) => value, withSequence: (...values: number[]) => values.at(-1), withSpring: (value: number) => value, withTiming: (value: number) => value };
    if (request === '@/gamification/native-effects') return { lightHaptic: async () => undefined };
    if (request === '@/motion/use-motion') return { useMotionEnabled: () => true };
    if (request === '@/sound/ui-sounds') return { playUiSound: () => undefined };
    if (request === '@/theme/palette') return { colorsForScheme: () => ({ primary: '#076F64', primaryContainer: '#E1F7EF', onPrimaryContainer: '#163D46' }) };
    if (request === '@/theme/contrast') return { withAlpha: (hex: string) => hex };
    if (request === '@/theme/ui-metrics') return { uiMetrics: { pageInset: 20, minTouch: 48 } };
    if (request === '@/theme/world') return { worldForScheme: () => ({ radius: { card: 22, chip: 999 }, card: '#fff', paperLine: '#A77C46', cardInk: '#163D46', cardMuted: '#567078', paper: '#F7EFE0', cardShadow: '#29493D', stampInk: '#A3401F', stampOrange: '#CA6E29' }) };
    if (request === '@/ui/bounce-button') return { BounceButton: 'BounceButton' };
    if (request === './registration-plan') return { buildRegistrationPlan: () => ({ slots: [], newCount: 0, duplicateOrOwnedCount: 0, summary: '' }) };
    return {};
  };
}
