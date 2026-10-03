import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCollectionShareCard,
  collectionShareCaptureSize,
  collectionShareCardFooter,
  collectionShareCardSize,
  collectionShareCardTitle,
  type CollectionShareCardInput,
} from './collection-share-card';

type Collectible = CollectionShareCardInput['collectibles'][number];

function collectible(id: string, merchantId: string, goal: 1 | 3 | 5, earnedAt: string, overrides: Partial<Collectible> = {}): Collectible {
  return {
    entitlementId: `ent-${id}`,
    merchantId,
    merchantName: `가게 ${merchantId}`,
    displayName: `이름 ${id}`,
    targetVisitCount: goal,
    earnedAt,
    artwork: {
      publicationId: `pub-${id}`,
      gradeId: `grade-${goal}`,
      name: `수집품 ${id}`,
      thumbnailDataUrl: `data:image/png;base64,thumb${id}`,
    },
    ...overrides,
  };
}

const visits = [{ merchantId: 'm1' }, { merchantId: 'm1' }, { merchantId: 'm2' }];
const noMedals: CollectionShareCardInput['medals'] = [];

test('the card names the stores visited, counting each store once', () => {
  const model = buildCollectionShareCard({ visits, collectibles: [collectible('a', 'm1', 1, '2026-10-01T00:00:00Z')], medals: noMedals });
  assert.equal(model.visitedStoreCount, 2);
  assert.equal(model.title, '나의 월계 도감');
  assert.equal(model.subtitle, '2곳의 가게를 모았어요');
  assert.equal(model.footer, 'MassCOM · 월계 동네 수집');
  assert.equal(collectionShareCardTitle, '나의 월계 도감');
  assert.equal(collectionShareCardFooter, 'MassCOM · 월계 동네 수집');
});

test('a store that only appears through a collectible still counts', () => {
  const model = buildCollectionShareCard({ visits: [], collectibles: [collectible('a', 'm9', 1, '2026-10-01T00:00:00Z')], medals: noMedals });
  assert.equal(model.visitedStoreCount, 1);
});

test('the grid shows the highest grade first, then the newest', () => {
  const model = buildCollectionShareCard({
    visits,
    collectibles: [
      collectible('old-bronze', 'm1', 1, '2026-09-01T00:00:00Z'),
      collectible('new-bronze', 'm1', 1, '2026-10-02T00:00:00Z'),
      collectible('silver', 'm2', 3, '2026-09-15T00:00:00Z'),
      collectible('gold', 'm2', 5, '2026-08-01T00:00:00Z'),
      collectible('new-silver', 'm1', 3, '2026-10-01T00:00:00Z'),
    ],
    medals: noMedals,
  });
  assert.deepEqual(model.items.map((item) => item.title), ['수집품 gold', '수집품 new-silver', '수집품 silver', '수집품 new-bronze', '수집품 old-bronze']);
  assert.deepEqual(model.items.map((item) => item.grade), ['GOLD', 'SILVER', 'SILVER', 'BRONZE', 'BRONZE']);
});

test('the grid keeps at most six collectibles', () => {
  const collectibles = Array.from({ length: 9 }, (_, index) => collectible(String(index), `m${index}`, 1, `2026-10-0${index + 1}T00:00:00Z`));
  const model = buildCollectionShareCard({ visits, collectibles, medals: noMedals });
  assert.equal(model.items.length, 6);
  // 같은 등급이면 최근 것부터 6장.
  assert.deepEqual(model.items.map((item) => item.title), ['수집품 8', '수집품 7', '수집품 6', '수집품 5', '수집품 4', '수집품 3']);
});

test('each item carries only its title, store, grade and picture', () => {
  const model = buildCollectionShareCard({ visits, collectibles: [collectible('a', 'm1', 5, '2026-10-01T00:00:00Z')], medals: noMedals });
  assert.deepEqual(model.items, [{ title: '수집품 a', storeName: '가게 m1', grade: 'GOLD', imageUri: 'data:image/png;base64,thumba' }]);
});

test('the same published picture earned twice shows once, as its best copy', () => {
  const twice = [
    collectible('a', 'm1', 1, '2026-09-01T00:00:00Z', { entitlementId: 'ent-1' }),
    collectible('a', 'm1', 1, '2026-10-01T00:00:00Z', { entitlementId: 'ent-2' }),
  ];
  const model = buildCollectionShareCard({ visits, collectibles: twice, medals: noMedals });
  assert.equal(model.items.length, 1);
});

test('a collectible without a published picture still gets a frame, named by its display name', () => {
  const legacy = collectible('legacy', 'm2', 3, '2026-10-01T00:00:00Z', { artwork: undefined, displayName: '실버 도장' });
  const model = buildCollectionShareCard({ visits, collectibles: [legacy], medals: noMedals });
  assert.deepEqual(model.items, [{ title: '실버 도장', storeName: '가게 m2', grade: 'SILVER', imageUri: null }]);
});

test('two legacy collectibles are not merged into one', () => {
  const first = collectible('l1', 'm1', 1, '2026-10-01T00:00:00Z', { artwork: undefined });
  const second = collectible('l2', 'm2', 1, '2026-10-02T00:00:00Z', { artwork: undefined });
  assert.equal(buildCollectionShareCard({ visits, collectibles: [first, second], medals: noMedals }).items.length, 2);
});

test('the medal row lists earned medals in the fixed explorer, regular, steady order', () => {
  const model = buildCollectionShareCard({
    visits,
    collectibles: [collectible('a', 'm1', 1, '2026-10-01T00:00:00Z')],
    medals: [
      { kind: 'steady', tier: 1 },
      { kind: 'regular', tier: 0 },
      { kind: 'explorer', tier: 3 },
    ],
  });
  assert.deepEqual(model.medals, [
    { kind: 'explorer', label: '동네 탐험가', tier: 3, tierLabel: '골드' },
    { kind: 'steady', label: '꾸준한 걸음', tier: 1, tierLabel: '브론즈' },
  ]);
});

test('with no badge book the card simply has no medal row', () => {
  const model = buildCollectionShareCard({ visits, collectibles: [collectible('a', 'm1', 1, '2026-10-01T00:00:00Z')], medals: noMedals });
  assert.deepEqual(model.medals, []);
});

test('only the showcase build marks the card as a virtual record', () => {
  const input = { visits, collectibles: [collectible('a', 'm1', 1, '2026-10-01T00:00:00Z')], medals: noMedals };
  assert.equal(buildCollectionShareCard(input).demoNote, null);
  assert.equal(buildCollectionShareCard(input, 'production').demoNote, null);
  assert.equal(buildCollectionShareCard(input, 'showcase').demoNote, '체험용 가상 기록');
});

// 공유 카드는 SNS에 그대로 올라간다. 입력(도감 응답)에 계정·날짜·지갑이 실려 있어도 모델에는 한 글자도 새지 않아야 한다.
test('the model never carries an account, nickname, email, date, wallet, QR or friend code', () => {
  const leaky = {
    accountId: 'acct-7f3a91',
    nickname: '별빛탐험대장',
    email: 'someone@gmail.com',
    friendCode: 'FRIEND-K3M9QZ',
    claimToken: 'claim-token-xyz',
    visits: [
      { visitEventId: 'visit-1', merchantId: 'm1', businessDate: '2026-10-01', progressCounted: true, accountId: 'acct-7f3a91' },
      { visitEventId: 'visit-2', merchantId: 'm2', businessDate: '2026-10-02', progressCounted: false },
    ],
    collectibles: [
      {
        ...collectible('a', 'm1', 5, '2026-10-01T09:30:00Z'),
        recipient: '0x1234567890abcdef1234567890abcdef12345678',
        nft: { chainId: 8453, contractAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', tokenId: '77' },
        nftStatus: 'FINALIZED',
        mintJobId: 'job-9',
        qrPayload: 'masscom://claim/qr-secret',
      },
      collectible('b', 'm2', 3, '2026-10-02T09:30:00Z', { artwork: undefined }),
    ],
    medals: [{ kind: 'explorer' as const, tier: 2 as const, value: 4, thresholds: [1, 3, 6] as const }],
  };
  const model = buildCollectionShareCard(leaky, 'showcase');
  const json = JSON.stringify(model);
  const forbidden = [
    'acct-7f3a91', 'accountId', '별빛탐험대장', 'nickname', 'someone@gmail.com', '@', 'email',
    'FRIEND-K3M9QZ', 'friendCode', 'claim-token-xyz', 'visit-1', 'visit-2', 'ent-a', 'ent-b',
    '2026-10-01', '2026-10-02', '09:30', 'earnedAt', 'businessDate',
    '0x1234567890abcdef', '0xabcdefabcdef', 'recipient', 'contractAddress', 'wallet', 'tokenId', 'chainId',
    'qr-secret', 'qrPayload', 'job-9', 'masscom://',
  ];
  for (const word of forbidden) assert.ok(!json.includes(word), `leaked ${word}`);
  assert.doesNotMatch(json, /\d{4}-\d{2}-\d{2}/, 'no ISO date');
  assert.doesNotMatch(json, /0x[0-9a-fA-F]{6}/, 'no wallet address');
  assert.doesNotMatch(json, /qr/i, 'no QR');
  // 모델의 키는 화면에 그릴 것만이다.
  assert.deepEqual(Object.keys(model).sort(), ['demoNote', 'footer', 'items', 'medals', 'subtitle', 'title', 'visitedStoreCount']);
  for (const item of model.items) assert.deepEqual(Object.keys(item).sort(), ['grade', 'imageUri', 'storeName', 'title']);
  for (const medal of model.medals) assert.deepEqual(Object.keys(medal).sort(), ['kind', 'label', 'tier', 'tierLabel']);
});

test('the card is 4:5 and is captured at 1080×1350 with the same ratio', () => {
  assert.equal(collectionShareCardSize.width * 5, collectionShareCardSize.height * 4);
  assert.deepEqual({ ...collectionShareCaptureSize }, { width: 1080, height: 1350 });
  assert.equal(collectionShareCaptureSize.width * collectionShareCardSize.height, collectionShareCaptureSize.height * collectionShareCardSize.width);
});
