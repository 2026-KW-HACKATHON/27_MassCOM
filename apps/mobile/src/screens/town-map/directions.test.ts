import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NAVER_APP_NAME, directionsTargets, openDirections, type DirectionsTargets } from './directions';

const real = { roadAddress: '서울특별시 노원구 월계로 12길 7', demo: false };

function targetsOf(merchant: { roadAddress: string; demo: boolean }): DirectionsTargets {
  const targets = directionsTargets(merchant);
  assert.ok(targets, 'a real merchant has targets');
  return targets;
}

test('a real merchant gets Naver and Kakao links that search its road address', () => {
  const encoded = encodeURIComponent(real.roadAddress);
  const { naver, kakao } = targetsOf(real);
  assert.equal(naver.app, `nmap://search?query=${encoded}&appname=kr.masscom.wolgye`);
  assert.equal(naver.web, `https://map.naver.com/p/search/${encoded}`);
  assert.equal(kakao.app, `kakaomap://search?q=${encoded}`);
  assert.equal(kakao.web, `https://map.kakao.com/?q=${encoded}`);
  assert.equal(NAVER_APP_NAME, 'kr.masscom.wolgye');
});

test('Korean text, spaces and URL special characters are percent-encoded so they cannot break out of the query', () => {
  const address = '월계로 12길 7 (1층) & 2호#3?a=b/c+d%e';
  const { naver, kakao } = targetsOf({ roadAddress: address, demo: false });
  const payloads = [
    naver.app.slice(naver.app.indexOf('query=') + 'query='.length, naver.app.indexOf('&appname=')),
    naver.web.slice(naver.web.lastIndexOf('/search/') + '/search/'.length),
    kakao.app.slice(kakao.app.indexOf('q=') + 2),
    kakao.web.slice(kakao.web.indexOf('?q=') + 3),
  ];
  for (const payload of payloads) {
    assert.doesNotMatch(payload, /[ &#?/+=]/, `${payload} has a raw separator`);
    assert.equal(decodeURIComponent(payload), address, 'the address survives the round trip');
  }
  assert.ok(naver.app.includes('%EC%9B%94%EA%B3%84%EB%A1%9C%2012%EA%B8%B8%207'), 'Korean and spaces');
  assert.ok(naver.app.includes('%26') && kakao.web.includes('%23') && kakao.web.includes('%3F') && kakao.web.includes('%25'), '& # ? %');
  // The only raw ampersand in the Naver app link is the one before appname.
  assert.equal(naver.app.split('&').length, 2);
});

test('the Naver app link carries the package-style app name and the others do not', () => {
  const { naver, kakao } = targetsOf(real);
  assert.ok(naver.app.endsWith('&appname=kr.masscom.wolgye'));
  for (const url of [naver.web, kakao.app, kakao.web]) assert.doesNotMatch(url, /appname/);
});

test('a demo merchant has no directions at all, because its place is not real', () => {
  assert.equal(directionsTargets({ roadAddress: '시연용 가상 위치 · 실제 방문 불가', demo: true }), null);
  assert.equal(directionsTargets({ roadAddress: real.roadAddress, demo: true }), null);
});

test('a blank road address has nothing to search, so there are no directions either', () => {
  assert.equal(directionsTargets({ roadAddress: '   ', demo: false }), null);
  assert.equal(directionsTargets({ roadAddress: '', demo: false }), null);
});

test('the address is trimmed before it is searched', () => {
  const { kakao } = targetsOf({ roadAddress: '  월계로 1  ', demo: false });
  assert.equal(kakao.app, `kakaomap://search?q=${encodeURIComponent('월계로 1')}`);
});

function opener(rejecting: readonly string[] = []) {
  const opened: string[] = [];
  const open = async (url: string) => {
    opened.push(url);
    if (rejecting.some((prefix) => url.startsWith(prefix))) throw new Error('no app can open this link');
    return true;
  };
  return { open, opened };
}

test('the app link opens first and the web page is left alone when the app opens', async () => {
  const targets = targetsOf(real);
  for (const provider of ['naver', 'kakao'] as const) {
    const { open, opened } = opener();
    assert.equal(await openDirections(targets, provider, open), true);
    assert.deepEqual(opened, [targets[provider].app]);
  }
});

test('when the app cannot open the link the web page opens instead', async () => {
  const targets = targetsOf(real);
  const naver = opener(['nmap:']);
  assert.equal(await openDirections(targets, 'naver', naver.open), true);
  assert.deepEqual(naver.opened, [targets.naver.app, targets.naver.web]);
  const kakao = opener(['kakaomap:']);
  assert.equal(await openDirections(targets, 'kakao', kakao.open), true);
  assert.deepEqual(kakao.opened, [targets.kakao.app, targets.kakao.web]);
});

test('the other provider is never touched by a choice', async () => {
  const targets = targetsOf(real);
  const { open, opened } = opener(['nmap:']);
  await openDirections(targets, 'naver', open);
  assert.equal(opened.some((url) => url.startsWith('kakaomap:') || url.includes('kakao')), false);
});

test('when even the web page cannot open, the caller is told instead of the error being swallowed as success', async () => {
  const targets = targetsOf(real);
  const { open, opened } = opener(['nmap:', 'https:']);
  assert.equal(await openDirections(targets, 'naver', open), false);
  assert.deepEqual(opened, [targets.naver.app, targets.naver.web]);
});
