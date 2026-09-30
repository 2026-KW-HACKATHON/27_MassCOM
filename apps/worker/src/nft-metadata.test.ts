import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  DEFAULT_STAMP_IMAGE_PATH,
  buildNftMetadata,
  parseNftMetadataOrigin,
  visitStepLabel,
  type NftMetadataFacts,
} from './nft-metadata.js';

const art = Buffer.from('RIFF-fake-webp-bytes');
const facts: NftMetadataFacts = {
  storePublic: true,
  merchantName: '월계 김밥',
  neighborhood: '월계동',
  category: '분식',
  campaignTitle: '가을 방문 도감',
  targetVisitCount: 3,
  artImage: art,
};

test('메타데이터는 이름·설명·그림·속성 다섯 개를 정해진 순서로 담는다', () => {
  const snapshot = buildNftMetadata(facts, 'https://masscom.kr');
  const sha = createHash('sha256').update(art).digest('hex');
  assert.deepEqual(JSON.parse(snapshot.json), {
    name: '월계 김밥 방문 도장',
    description: '월계동 월계 김밥 3번째 방문 도장입니다. 월계 마스코트 방문 도감이 발행한 기념 NFT이며 다른 지갑으로 보낼 수 없습니다.',
    image: `https://masscom.kr/nft-metadata/images/${sha}.webp`,
    attributes: [
      { trait_type: '가게 이름', value: '월계 김밥' },
      { trait_type: '동네', value: '월계동' },
      { trait_type: '업종', value: '분식' },
      { trait_type: '방문 단계', value: '3번째 방문' },
      { trait_type: '캠페인', value: '가을 방문 도감' },
      { trait_type: '그림', value: 'AI 생성' },
    ],
  });
  // 저장·응답 바이트가 키 순서까지 고정이다.
  assert.equal(Object.keys(JSON.parse(snapshot.json)).join(','), 'name,description,image,attributes');
  assert.deepEqual(snapshot.image, { sha256: sha, bytes: art });
});

test('그림 주소는 열에 적힌 값이 아니라 실제 바이트의 sha256이고, 그림이 없으면 판이 붙은 기본 도장이며 AI 표시가 없다', () => {
  const other = buildNftMetadata({ ...facts, artImage: Buffer.from('different') }, 'https://masscom.kr');
  assert.notEqual(JSON.parse(other.json).image, JSON.parse(buildNftMetadata(facts, 'https://masscom.kr').json).image);
  for (const artImage of [null, Buffer.alloc(0)]) {
    const fallback = buildNftMetadata({ ...facts, artImage }, 'https://masscom.kr');
    assert.equal(JSON.parse(fallback.json).image, 'https://masscom.kr/nft-metadata/default/mascot-stamp-v1.png');
    assert.equal(fallback.image, null);
    assert.equal(fallback.json.includes('AI 생성'), false);
  }
  assert.equal(DEFAULT_STAMP_IMAGE_PATH, '/nft-metadata/default/mascot-stamp-v1.png');
  // 시연은 자기 출처의 기본 도장을 쓴다.
  assert.equal(JSON.parse(buildNftMetadata({ ...facts, artImage: null }, 'https://demo-api.masscom.kr').json).image,
    'https://demo-api.masscom.kr/nft-metadata/default/mascot-stamp-v1.png');
  const showcase = buildNftMetadata(facts, 'https://demo-api.masscom.kr');
  assert.match(JSON.parse(showcase.json).image, /^https:\/\/demo-api\.masscom\.kr\/nft-metadata\/images\/[0-9a-f]{64}\.webp$/);
});

test('동네·업종이 비어 있으면 그 속성과 설명의 동네를 뺀다', () => {
  const bare = JSON.parse(buildNftMetadata({ ...facts, neighborhood: null, category: '  ', targetVisitCount: 1 },
    'https://masscom.kr').json);
  assert.deepEqual(bare.attributes.map((item: { trait_type: string }) => item.trait_type), ['가게 이름', '방문 단계', '캠페인', '그림']);
  assert.equal(bare.description.startsWith('월계 김밥 첫 방문 도장입니다.'), true);
  assert.equal(bare.attributes[1].value, '첫 방문');
});

test('공개 중이 아닌 점포는 가게 이름·동네·업종·캠페인·그림 없이 방문 단계만 담은 일반 도장이다', () => {
  const generic = buildNftMetadata({ ...facts, storePublic: false }, 'https://masscom.kr');
  assert.deepEqual(JSON.parse(generic.json), {
    name: '월계 방문 도장',
    description: '월계 마스코트 방문 도감의 3번째 방문 도장입니다. 다른 지갑으로 보낼 수 없는 기념 NFT입니다.',
    image: 'https://masscom.kr/nft-metadata/default/mascot-stamp-v1.png',
    attributes: [{ trait_type: '방문 단계', value: '3번째 방문' }],
  });
  assert.equal(generic.image, null, 'store art is not copied for a store that is not public');
  for (const hidden of ['월계 김밥', '월계동', '분식', '가을 방문 도감', 'AI 생성']) {
    assert.equal(generic.json.includes(hidden), false, hidden);
  }
});

test('방문 단계는 1이면 첫 방문, 그 밖은 n번째 방문이다', () => {
  assert.equal(visitStepLabel(1), '첫 방문');
  assert.equal(visitStepLabel(3), '3번째 방문');
  assert.equal(visitStepLabel(5), '5번째 방문');
  for (const invalid of [0, -1, 1.5, Number.NaN]) assert.throws(() => visitStepLabel(invalid));
});

test('메타데이터에는 주소·시각·지갑·계정·주문 모양 값이 없다', () => {
  const text = buildNftMetadata(facts, 'https://masscom.kr').json;
  assert.doesNotMatch(text, /0x[0-9a-fA-F]{40}/, 'wallet address');
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}|\d{1,2}:\d{2}/, 'timestamp');
  assert.doesNotMatch(text, /@|acct_|주문|결제|로\s?\d|길\s?\d|번지/, 'account, order or street address');
  assert.doesNotMatch(text, /tokenId|transaction|reward|recipient|owner/i);
  const keys = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) { keys.add(key); walk(nested); }
    }
  };
  walk(JSON.parse(text));
  assert.deepEqual([...keys].sort(), ['attributes', 'description', 'image', 'name', 'trait_type', 'value']);
  assert.deepEqual(JSON.parse(text).attributes.map((item: { trait_type: string }) => item.trait_type),
    ['가게 이름', '동네', '업종', '방문 단계', '캠페인', '그림']);
});

test('NFT_METADATA_ORIGIN은 https 출처만 받고 경로·끝 슬래시·쿼리는 거절한다(로컬 http는 예외)', () => {
  assert.equal(parseNftMetadataOrigin('https://masscom.kr'), 'https://masscom.kr');
  assert.equal(parseNftMetadataOrigin(' https://demo-api.masscom.kr '), 'https://demo-api.masscom.kr');
  assert.equal(parseNftMetadataOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  for (const invalid of [undefined, '', 'masscom.kr', 'http://masscom.kr', 'https://masscom.kr/',
    'https://masscom.kr/nft-metadata', 'https://masscom.kr?x=1', 'https://user@masscom.kr', 'ftp://masscom.kr',
    'https://MassCOM.kr']) {
    assert.throws(() => parseNftMetadataOrigin(invalid), /NFT_METADATA_ORIGIN/, String(invalid));
  }
});
