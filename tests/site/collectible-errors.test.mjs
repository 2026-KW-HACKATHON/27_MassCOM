import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { COLLECTIBLE_ERROR_CODES, COLLECTIBLE_ERROR_MESSAGES, collectibleErrorMessage, localError } from '../../apps/production-web/assets/collectible-errors.mjs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
// 서버 응답 코드는 server.ts와 거기서 나뉜 http/·routes/ 모듈에 흩어져 있다.
const apiSources = ['apps/api/src/server.ts', ...['http', 'routes'].flatMap(dir => existsSync(new URL(`../../apps/api/src/${dir}`, import.meta.url))
  ? readdirSync(new URL(`../../apps/api/src/${dir}`, import.meta.url)).filter(name => name.endsWith('.ts')).sort().map(name => `apps/api/src/${dir}/${name}`) : [])];
const doc = read('docs/COLLECTIBLE_CREATOR.md');
const customerOnly = new Set(['COLLECTIBLE_NOT_FOUND']); // 보유자 상세 API 전용이라 제작기에서는 나오지 않는다.
const generic = collectibleErrorMessage({ status: 400, code: 'UNKNOWN_CODE' });

// 제작·탐색·열람·집계 경로의 코드: 계약 문서, 서비스 오류 타입, 서버 응답을 함께 검사한다.
const documented = [...(doc.match(/- 오류 코드 전체.*$/m)?.[0] ?? '').matchAll(/`([A-Z][A-Z_]+)`/g)].map(match => match[1]);
const union = read('apps/api/src/collectible-project.ts').match(/CollectibleProjectErrorCode =([^;]+);/)?.[1] ?? '';
const fromService = [...union.matchAll(/'([A-Z_]+)'/g)].map(match => match[1]);
const discoveryUnion = read('apps/api/src/merchant-discovery.ts').match(/MerchantDiscoveryErrorCode =([^;]+);/)?.[1] ?? '';
const fromDiscoveryService = [...discoveryUnion.matchAll(/'([A-Z_]+)'/g)].map(match => match[1]);
const fromServer = [...apiSources.map(read).join('\n').matchAll(/'((?:COLLECTIBLE_[A-Z_]+)|BODY_TOO_LARGE|MERCHANT_ACCESS_DENIED|MERCHANT_DETAIL_VIEWS_NOT_CONFIGURED|VIEW_SOURCE_INVALID|VIEW_RATE_LIMITED|ADMIN_FUNNEL_NOT_CONFIGURED|FUNNEL_DAYS_INVALID)'/g)].map(match => match[1]);
const all = [...new Set([...documented, ...fromService, ...fromDiscoveryService, ...fromServer])].filter(code => !customerOnly.has(code));

test('계약 문서·서버가 돌려주는 수집품·탐색·집계 오류 코드를 모두 읽어 낸다', () => {
  assert.ok(documented.length >= 14, `문서에서 코드를 읽지 못했어요: ${documented}`);
  assert.ok(fromService.length >= 10 && fromServer.includes('COLLECTIBLE_RATE_LIMITED'), '서버 코드 목록을 읽지 못했어요');
  for (const code of ['COLLECTIBLE_PREVIEW_NOT_FOUND', 'MERCHANT_NOT_FOUND']) {
    assert.ok(fromDiscoveryService.includes(code), `${code}를 탐색 서비스 오류 타입에서 읽지 못했어요`);
  }
  for (const code of ['COLLECTIBLE_PREVIEW_NOT_CONFIGURED', 'MERCHANT_DETAIL_VIEWS_NOT_CONFIGURED',
    'VIEW_SOURCE_INVALID', 'VIEW_RATE_LIMITED', 'ADMIN_FUNNEL_NOT_CONFIGURED', 'FUNNEL_DAYS_INVALID']) {
    assert.ok(fromServer.includes(code), `${code}를 서버 응답에서 읽지 못했어요`);
  }
});

test('서버·문서의 모든 오류 코드는 자기 한국어 문구가 있고 인터넷 안내로 새지 않는다', () => {
  for (const code of all) {
    assert.ok(COLLECTIBLE_ERROR_CODES.includes(code), `${code}에 편집기 문구가 없어요`);
    const message = collectibleErrorMessage({ status: 409, code, retryAfterSeconds: code === 'COLLECTIBLE_RATE_LIMITED' ? 7 : undefined });
    assert.notEqual(message, generic, `${code}가 일반 문구로 나가요`);
    assert.doesNotMatch(message, /인터넷 연결/, code);
    assert.match(message, /[가-힣]/, code);
  }
  for (const code of COLLECTIBLE_ERROR_CODES) assert.ok(documented.includes(code), `${code}가 계약 문서에 없어요`);
  assert.equal(new Set(Object.values(COLLECTIBLE_ERROR_MESSAGES)).size, COLLECTIBLE_ERROR_CODES.length, '서로 다른 코드가 같은 문구를 써요');
});

test('429는 Retry-After 초를 알려 주고, 413·401·서버 오류·오프라인을 각각 안내한다', () => {
  assert.match(collectibleErrorMessage({ status: 429, code: 'COLLECTIBLE_RATE_LIMITED', retryAfterSeconds: 42 }), /42초 뒤/);
  assert.match(collectibleErrorMessage({ status: 429 }), /잠시 뒤/);
  const viewLimited = collectibleErrorMessage({ status: 429, code: 'VIEW_RATE_LIMITED', retryAfterSeconds: 42 });
  assert.match(viewLimited, /열람.*42초 뒤/);
  assert.doesNotMatch(viewLimited, /저장·게시/);
  assert.match(collectibleErrorMessage({ status: 413 }), /8 MB/);
  assert.match(collectibleErrorMessage({ status: 401, code: 'WEB_SESSION_EXPIRED' }), /다시 로그인/);
  assert.match(collectibleErrorMessage({ status: 403 }), /권한/);
  assert.match(collectibleErrorMessage({ status: 502 }), /서버가 지금 응답하지 못했어요/);
  assert.match(collectibleErrorMessage(new TypeError('Failed to fetch')), /인터넷 연결/);
  assert.equal(collectibleErrorMessage(localError('완성 이미지가 너무 커요.')), '완성 이미지가 너무 커요.');
  assert.equal(collectibleErrorMessage({ status: 400, code: 'NEW_CODE' }, '목록을 못 불러왔어요.'), '목록을 못 불러왔어요.');
});
