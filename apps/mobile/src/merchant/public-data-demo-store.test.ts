import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PUBLIC_DATA_DEMO_STORE_LABEL, isPublicDataDemoStore, publicDataDemoStoreName } from './public-data-demo-store';
import { recommendationLabel, recommendationHint, reasonLabel } from '../screens/recommendations/recommendation-label';
import { markersForDiscovery } from '../screens/real-map/server-clusters';
import { buildTownPins } from '../screens/town-map/town-pins';
import type { MerchantSummary } from '../../../api/src/real-world-contract';

const id = 'showcase-wolgye-MA010120220800012345';
const name = '월계 식당';
const label = '실제 가게 정보로 만든 시연 · 참여하지 않은 가게';
const merchant: MerchantSummary = {
  id, name, demo: true, roadAddress: '월계로 1', thumbnail: null,
  position: { latitude: 37.6, longitude: 127 }, campaign: null, distance: null,
  category: null, profileVersion: 1, positionBasis: 'OWNED', positionExpiresAt: null, floor: null, entranceNote: null,
  business: { state: 'UNKNOWN', basis: 'UNKNOWN', evaluatedAt: '2026-10-09T00:00:00Z', nextChangeAt: null,
    informationUpdatedAt: null, acceptingOrders: null, lastOrderAt: null },
};

test('only the public-data demo ID prefix identifies a non-participating real store', () => {
  assert.equal(PUBLIC_DATA_DEMO_STORE_LABEL, label);
  assert.equal(isPublicDataDemoStore(id), true);
  for (const other of [undefined, '', 'showcase-a', 'real-merchant', 'showcase-wolgyex-1', `other-${id}`]) {
    assert.equal(isPublicDataDemoStore(other), false);
    assert.equal(publicDataDemoStoreName(other, name), name);
  }
  assert.equal(publicDataDemoStoreName(id, name), `${name} · ${label}`);
});

type Rendered = { type: string; props: Record<string, unknown>; children: unknown[] };
const style = new Proxy({}, { get: () => ({}) });

// Execute the production JSX with inert native primitives; test visible text and the actual accessible props.
function render(path: string, match: (node: ts.JsxElement) => boolean, bindings: Record<string, unknown>): Rendered {
  const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let element: ts.JsxElement | undefined;
  function find(node: ts.Node) {
    if (!element && ts.isJsxElement(node) && match(node)) element = node;
    if (!element) ts.forEachChild(node, find);
  }
  find(file);
  assert.ok(element, path);
  const context = {
    React: { createElement: (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
    Pressable: 'Pressable', View: 'View', Text: 'Text', Image: 'Image', FloatingCard: 'FloatingCard',
    MerchantCrest: 'MerchantCrest', FactLine: 'FactLine', MerchantMark: 'MerchantMark',
    styles: style, palette: style, world: style, publicDataDemoStoreName, ...bindings, result: undefined,
  };
  runInNewContext(ts.transpileModule(`result = (${element.getText(file)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.result as unknown as Rendered;
}

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return node && typeof node === 'object' && 'children' in node ? text((node as Rendered).children) : '';
}

function assertDisclosure(card: Rendered, accessible = true) {
  assert.ok(text(card).includes(label), 'visible disclosure');
  if (accessible) assert.ok(String(card.props.accessibilityLabel).includes(label), 'card accessible name includes disclosure');
}

test('discovery list/map/recommendation rows render the disclosure and include it in their accessible name', () => {
  const card = render('../screens/real-map/index.tsx', node => node.openingElement.getText().includes('key={merchant.id}'), {
    merchant, state: {}, source: 'list', apiUrl: '', facts: { critical: [] }, where: '', distance: null,
    businessLabel: () => '영업 미확인', button: () => null,
  });
  assertDisclosure(card);
});

test('recommendation cards render the disclosure and read it even when generic demo metadata is false', () => {
  const item = { merchantId: id, merchantName: name, roadAddress: '월계로 1', demo: false,
    progressVisitCount: 0, reasonCode: 'NEW_PLACE' as const, reasonText: '첫 가게', nextGoal: undefined };
  const card = render('../screens/recommendations/index.tsx', node => node.openingElement.getText().includes('recommendationLabel(item)'), {
    item, index: 0, recommendationLabel, recommendationHint, reasonLabel,
  });
  assertDisclosure(card);
});

test('home first-store and ticket cards render the disclosure with an accessible name', () => {
  const firstStore = { merchantId: id, name, reason: '첫 가게' };
  assertDisclosure(render('../screens/home/index.tsx', node => node.openingElement.getText().includes('처음이라면'), { firstStore, StyleSheet: { flatten: (value: unknown) => value } }));
  assertDisclosure(render('../screens/home/index.tsx', node => node.openingElement.getText().includes('ticket.count'), {
    id, ticket: { name, count: 1, grade: 'BRONZE' }, require: () => 1,
  }));
  assertDisclosure(render('../screens/home/index.tsx', node => node.openingElement.tagName.getText() === 'Text' && node.getText().includes('goal.count'), {
    goal: { merchantId: id, name, count: 1 }, body: {},
  }), false);
});

test('route stop names, replacement choices and arrival rows carry the same disclosure', () => {
  const file = '../screens/real-map/index.tsx';
  assertDisclosure(render(file, node => node.openingElement.tagName.getText() === 'Text' && node.getText().includes('머무름 {stop.dwellMinutes}'), {
    index: 0, latest: merchant, m: merchant, stop: { merchantId: id, dwellMinutes: 5 },
  }), false);
  const option = merchant;
  const row = render(file, node => node.openingElement.getText().includes('key={option.id}'), {
    option, index: 0, button: (title: string) => title,
  });
  assertDisclosure(row, false);
  assertDisclosure(render(file, node => node.openingElement.getText().includes('key={stop.merchantId}'), {
    state: { merchants: [merchant] }, stop: { merchantId: id, arrivalAt: '2026-10-09T00:00:00Z', warnings: [] },
  }), false);
});

test('both singleton cluster markers and ordinary provider callout titles carry the disclosure', () => {
  const stores = [merchant];
  const cluster = { id: 'cell', count: 1, position: merchant.position!,
    bounds: { south: 37.6, north: 37.6, west: 127, east: 127 } };
  for (const clusters of [[], [cluster]]) {
    assert.equal(markersForDiscovery(clusters, stores, new Set())[0]!.title, `${name} · ${label}`);
  }
});

test('town-map pins, overflow rows and selected-store callouts expose the disclosure', () => {
  const campaign = { id: 'c', title: '시연', startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z', enrollmentStatus: 'OPEN' as const, rewardGoals: [] };
  const { placed } = buildTownPins([{ ...merchant, campaign }], undefined, '2026-10-09T00:00:00Z');
  const pin = placed[0]!;
  assert.ok(pin.label.includes(label));
  assertDisclosure(render('../screens/town-map/index.tsx', node => node.openingElement.getText().includes('key={item.merchantId}'), {
    item: pin, selectedId: undefined, openerRef: () => undefined,
  }));
  assertDisclosure(render('../screens/town-map/pin-sheet.tsx', node => node.openingElement.getText().includes('ref={title}'), {
    pin, title: undefined,
  }), false);
});
