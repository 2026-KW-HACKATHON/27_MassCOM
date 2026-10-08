import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PUBLIC_DATA_DEMO_STORE_LABEL, publicDataDemoStoreName } from './public-data-demo-store';
import { buildCollectionShareCard } from '../screens/collection/collection-share-card';
import { toPassportStamp } from '../screens/collection/collection-stamps';

const id = 'showcase-wolgye-MA010120220800012345';
const name = '월계 식당';
const disclosed = `${name} · ${PUBLIC_DATA_DEMO_STORE_LABEL}`;
const styles = new Proxy({}, { get: () => ({}) });
type Element = { type: string; props: Record<string, unknown>; children: unknown[] };

// Execute the actual production Text JSX with inert native primitives, so a removed or changed label fails.
function renderedText(path: string, marker: string, bindings: Record<string, unknown>): string {
  const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let element: ts.JsxElement | undefined;
  function find(node: ts.Node) {
    if (!element && ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'Text' && node.getText(file).includes(marker)) element = node;
    if (!element) ts.forEachChild(node, find);
  }
  find(file);
  assert.ok(element, `${path}: ${marker}`);
  const context = { React: { createElement: (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props, children }) },
    Text: 'Text', styles, palette: styles, world: styles, publicDataDemoStoreName, ...bindings, __rendered: undefined };
  runInNewContext(ts.transpileModule(`__rendered = (${element.getText(file)});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  function visible(node: unknown): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(visible).join('');
    return node && typeof node === 'object' && 'children' in node ? visible((node as Element).children) : '';
  }
  const text = visible(context.__rendered);
  if (text.includes(PUBLIC_DATA_DEMO_STORE_LABEL)) {
    assert.equal((context.__rendered as unknown as Element).props.numberOfLines, undefined, 'disclosure must wrap without truncation');
  }
  return text;
}

test('secondary merchant rows render the disclosure from their IDs', () => {
  const rows: [string, string, Record<string, unknown>][] = [
    ['../screens/home/home-tickets.tsx', 'ticket.merchantId, ticket.merchantName', { ticket: { merchantId: id, merchantName: name } }],
    ['../screens/coin-shop/index.tsx', 'pool.merchantId, pool.merchantName', { pool: { merchantId: id, merchantName: name, eventName: '행사' } }],
    ['../screens/coin-collection/index.tsx', 'merchant.merchantId, merchant.merchantName', { merchant: { merchantId: id, merchantName: name }, owned: 1, grades: [1] }],
    ['../screens/room-explore/index.tsx', 'group.merchantId, group.merchantName', { group: { merchantId: id, merchantName: name } }],
    ['../screens/mail/detail.tsx', 'mail.mealInvitation.merchant.id', { mail: { mealInvitation: { merchant: { id, name } } } }],
    ['../screens/mail/compose.tsx', 'selectedMerchant.id, selectedMerchant.name', { selectedMerchant: { id, name } }],
    ['../screens/claim-redeem/index.tsx', 'merchant.id, merchant.name', { merchant: { id, name }, selected: false }],
    ['../screens/collection/collectible-browser.tsx', 'store.merchantId, store.merchantName', { store: { merchantId: id, merchantName: name } }],
    ['../screens/collection/index.tsx', 'visit.merchantId, visit.merchantName', { visit: { merchantId: id, merchantName: name } }],
    ['../screens/studio/index.tsx', 'source.merchantId, merchantName', { source: { merchantId: id }, merchantName: name }],
    ['../screens/studio/friend.tsx', 'item.merchantId, item.merchantName', { item: { merchantId: id, merchantName: name } }],
    ['../screens/play/quality-session.tsx', 'item.merchantId, item.merchantName', { item: { merchantId: id, merchantName: name } }],
    ['../gamification/coupon-ticket.tsx', 'coupon.merchantId, coupon.merchantName', { coupon: { merchantId: id, merchantName: name }, muted: undefined }],
    ['../gamification/coupon-use-sheet.tsx', 'coupon.merchantId, coupon.merchantName', { coupon: { merchantId: id, merchantName: name } }],
    ['../screens/collection/collectible-detail.tsx', 'merchantId, merchantName', { merchantId: id, merchantName: name, snapshot: { gradeName: '금', theme: { name: '방문' } } }],
    ['../screens/collection/collectible-share.tsx', 'item.merchantId, item.merchantName', { item: { merchantId: id, merchantName: name } }],
    ['../screens/shop/grade-draw-machine.tsx', 'reward.merchantId, reward.merchantName', { reward: { merchantId: id, merchantName: name }, result: { quantity: 1 } }],
    ['../gamification/celebration.tsx', 'content.merchantId, content.merchantName', { content: { merchantId: id, merchantName: name }, title: undefined }],
    ['../screens/friends/passport.tsx', '{displayName}', { displayName: disclosed, ui: styles }],
    ['../screens/collection/envelope/envelope-card.tsx', '{merchantName} ·', { merchantName: disclosed, collectible: { gradeName: '금' } }],
    ['../screens/collection/envelope/envelope-reveal.tsx', '{merchantName} 시리즈', { merchantName: disclosed, series: { slots: [{ owned: true }] } }],
    ['../ui/passport-stamp-page.tsx', '{stamp.name}', { stamp: { name: disclosed } }],
  ];
  for (const [path, marker, bindings] of rows) assert.ok(renderedText(path, marker, bindings).includes(disclosed), path);
});

test('fixed v2 backs omit store text while the surrounding detail discloses the store', () => {
  const back = readFileSync(new URL('../screens/collection/collectible-default-back.tsx', import.meta.url), 'utf8');
  assert.match(back, /<FixedBackImage shape=\{shape\} source=\{source\} size=\{size\}/);
  assert.doesNotMatch(back, /<Text\b|\{merchantName\}/);
  assert.ok(renderedText('../screens/collection/collectible-detail.tsx', 'merchantId, merchantName',
    { merchantId: id, merchantName: name, snapshot: { gradeName: '금', theme: { name: '방문' } } }).includes(disclosed));
});

test('studio share image visibly identifies a non-participating real store', () => {
  const file = '../studio/studio-share.tsx';
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(source, /first && isPublicDataDemoStore\(first\.merchantId\) \? <Text[^>]*>\{PUBLIC_DATA_DEMO_STORE_LABEL\}<\/Text>/);
  assert.ok(renderedText(file, '{PUBLIC_DATA_DEMO_STORE_LABEL}', { PUBLIC_DATA_DEMO_STORE_LABEL }).includes(PUBLIC_DATA_DEMO_STORE_LABEL));
});

function renderedAccessibleName(path: string, marker: string, bindings: Record<string, unknown>, attribute = 'accessibilityLabel'): string {
  const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  function find(node: ts.Node) {
    if (!expression && ts.isJsxAttribute(node) && node.name.getText(file) === attribute && node.getText(file).includes(marker)
      && node.initializer && ts.isJsxExpression(node.initializer)) expression = node.initializer.expression;
    if (!expression) ts.forEachChild(node, find);
  }
  find(file);
  assert.ok(expression, `${path}: ${marker}`);
  const context = { publicDataDemoStoreName, ...bindings, __accessible: undefined };
  runInNewContext(ts.transpileModule(`__accessible = (${expression.getText(file)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return String(context.__accessible);
}

test('secondary cards announce the disclosure in explicit accessible names', () => {
  const labels: [string, string, Record<string, unknown>][] = [
    ['../screens/home/home-tickets.tsx', 'ticket.merchantId, ticket.merchantName', { ticket: { merchantId: id, merchantName: name, displayName: '수집품' } }],
    ['../screens/collection/collectible-browser.tsx', 'group.merchantId, group.merchantName', { group: { merchantId: id, merchantName: name, artwork: { name: '수집품', gradeName: '금' }, count: 1 } }],
    ['../studio/studio-scene.tsx', 'item.merchantId, item.merchantName', { item: { merchantId: id, merchantName: name, displayName: '수집품' } }],
    ['../screens/shop/grade-draw-machine.tsx', 'reward.merchantId, reward.merchantName', {
      reward: { kind: 'COIN', merchantId: id, merchantName: name, name: '수집품' }, tone: { name: '금' }, kindName: { COIN: '코인' }, result: { duplicate: false },
    }],
    ['../screens/collection/envelope/envelope-reveal.tsx', 'current.collectible.name', {
      merchantName: disclosed, current: { collectible: { name: '수집품', gradeName: '금' }, isNew: true }, cardStep: { index: 0 }, cards: [1],
    }],
  ];
  for (const [path, marker, bindings] of labels) assert.ok(renderedAccessibleName(path, marker, bindings).includes(PUBLIC_DATA_DEMO_STORE_LABEL), path);
  assert.equal(renderedAccessibleName('../screens/collection/collectible-reveal.tsx', 'batchMerchantId, merchantName', {
    batchMerchantId: id, merchantName: name,
  }, 'merchantName'), disclosed);

  const path = '../gamification/reward-box.tsx';
  const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: ts.Expression | undefined;
  function findOffer(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'offerLine') initializer = node.initializer;
    ts.forEachChild(node, findOffer);
  }
  findOffer(file);
  assert.ok(initializer);
  const context = { reward: { state: 'READY', offer: { merchantId: id, merchantName: name, title: '보상' } }, publicDataDemoStoreName, offerLine: '' };
  runInNewContext(ts.transpileModule(`offerLine = (${initializer.getText(file)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  assert.ok(context.offerLine.includes(disclosed));
  assert.ok(renderedAccessibleName(path, 'offerLine', { reward: context.reward, earnedTiers: [], offerLine: context.offerLine, rewardAccessibilityLabel: () => '보상 상자' }).includes(disclosed));
});

test('passport and exported collection models carry the disclosure', () => {
  const stamp = toPassportStamp({ merchantId: id, merchantName: name, visited: false, visitCount: 0 },
    { merchantId: id, progressCount: 0, earnedGoals: [], totalGoals: 0, nextGoal: null, remainingVisits: null, campaignStatus: 'open' });
  assert.equal(stamp.name, disclosed);
  assert.ok(stamp.label.includes(PUBLIC_DATA_DEMO_STORE_LABEL));
  const shared = buildCollectionShareCard({ visits: [{ merchantId: id }], collectibles: [{ entitlementId: 'e', merchantId: id,
    merchantName: name, displayName: '수집품', targetVisitCount: 1, earnedAt: '2026-10-09T00:00:00Z' }], medals: [] });
  assert.equal(shared.items[0]?.storeName, disclosed);
});
