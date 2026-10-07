import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { contextualTab, primaryDestinations } from './context-tabs';

const require = createRequire(import.meta.url);
const { stripBaseUrl } = require('expo-router/build/fork/getStateFromPath-forks');
const { stripGroupSegmentsFromPath } = require('expo-router/build/matchers');
const { TabRouter } = require('expo-router/build/react-navigation/routers/TabRouter');
const { StackRouter } = require('expo-router/build/react-navigation/routers/StackRouter');

// Execute the actual button handler against the installed path parser and tab reducer.
const source = ts.createSourceFile('context-tab-bar.tsx', readFileSync(new URL('./context-tab-bar.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler: ts.Node | undefined;
function findHandler(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onPress'
    && node.initializer && ts.isJsxExpression(node.initializer)) handler = node.initializer.expression;
  ts.forEachChild(node, findHandler);
}
findHandler(source);
assert.ok(handler);
const handlerCode = ts.transpileModule(`callback = ${handler.getText(source)}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

test('every contextual tab reaches its route from settings and friends with or without /play', () => {
  const routeNames = ['search', 'collection', 'index', 'play-tab', 'shop', 'friends', 'settings'];
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  const tabs = TabRouter({ backBehavior: 'history', initialRouteName: 'index' });
  const expected = ['search', 'collection', 'index', 'play-tab', 'shop'];
  for (const baseUrl of ['/play', '']) {
    for (const origin of ['settings', 'friends']) {
      primaryDestinations.forEach((destination, index) => {
        let state = tabs.getInitialState(options);
        state = tabs.getStateForAction(state, { type: 'NAVIGATE', payload: { name: origin } }, options);
        const dispatch = (href: string, type: string) => {
          const path = stripGroupSegmentsFromPath(stripBaseUrl(href, baseUrl));
          const name = path === '' || path === '/' ? 'index' : path.slice(1);
          state = tabs.getStateForAction(state, { type, payload: { name } }, options);
        };
        const context = { callback: undefined as unknown as () => void, destination, insideTabs: true, router: {
          navigate: (href: string) => dispatch(href, 'NAVIGATE'),
          dismissTo: (href: string) => dispatch(href, 'POP_TO'),
        } };
        runInNewContext(handlerCode, context);
        context.callback();
        assert.ok(state, `${origin} → ${destination.label} (${baseUrl || 'Android'})`);
        assert.equal(state.routes[state.index].name, expected[index]);
      });
    }
  }
});

test('stacked subpages return to the existing primary navigator without duplicating it', () => {
  const expected = ['search', 'collection', 'index', 'play-tab', 'shop'];
  for (const baseUrl of ['/play', '']) {
    for (const origin of ['studio', 'profile', 'home/tickets', 'coin-collection', 'home/exhibit',
      'home/missions', 'room-explore', 'friends/[friendshipId]/studio']) {
      const options = { routeNames: ['(tabs)', origin], routeParamList: {}, routeGetIdList: {} };
      const stack = StackRouter({ initialRouteName: '(tabs)' });
      primaryDestinations.forEach((destination, index) => {
        let state = stack.getInitialState(options);
        state = stack.getStateForAction(state, { type: 'PUSH', payload: { name: origin } }, options);
        const dispatch = (href: string, type: string) => {
          const path = stripGroupSegmentsFromPath(stripBaseUrl(href, baseUrl));
          state = stack.getStateForAction(state, { type, payload: { name: '(tabs)', params: {
            screen: path === '' || path === '/' ? 'index' : path.slice(1),
          } } }, options);
        };
        const context = { callback: undefined as unknown as () => void, destination, insideTabs: false, router: {
          navigate: (href: string) => dispatch(href, 'NAVIGATE'),
          dismissTo: (href: string) => dispatch(href, 'POP_TO'),
        } };
        runInNewContext(handlerCode, context);
        context.callback();
        assert.ok(state);
        assert.equal(state.routes.length, 1, `${origin} → ${destination.label}`);
        assert.equal(state.routes[0].name, '(tabs)');
        assert.equal(state.routes[0].params.screen, expected[index]);
      });
    }
  }
});

test('contextual tabs keep the five primary destinations in bar order', () => {
  assert.deepEqual(primaryDestinations.map(({ href, label }) => [href, label]), [
    ['/(tabs)/search', '탐색'], ['/(tabs)/collection', '도감'], ['/(tabs)', '홈'], ['/(tabs)/play-tab', '놀이'], ['/(tabs)/shop', '상점'],
  ]);
});

test('account settings and friends keep the contextual home tab available', () => {
  assert.equal(contextualTab('/settings'), 2);
  assert.equal(contextualTab('/friends'), 2);
});

test('room exploration and coin collection select their source tabs', () => {
  assert.equal(contextualTab('/room-explore'), 0);
  assert.equal(contextualTab('/coin-collection'), 1);
});

test('coin reroll and inventory keep the shop tab selected', () => {
  assert.equal(contextualTab('/coin-shop'), 4);
  assert.equal(contextualTab('/room-inventory'), 4);
});

test('unknown, camera and game routes hide the contextual tab bar', () => {
  for (const path of ['/unknown', '/claim', '/play', '/play-tab', '/camera', '/wallet']) {
    assert.equal(contextualTab(path), null, path);
  }
});
