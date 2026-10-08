import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isRoutableMerchantId, merchantLink, merchantShareMessage, parseMerchantLink } from './recommend';

test('builds the merchant link with the id escaped in the fragment', () => {
  assert.equal(merchantLink('showcase-wolgye-MA010120220813334279'), 'https://masscom.kr/open#merchant=showcase-wolgye-MA010120220813334279');
  assert.equal(merchantLink('showcase-wolgye-MA010120220813334279', 'development'), 'https://masscom.kr/open#merchant=showcase-wolgye-MA010120220813334279');
  assert.equal(merchantLink('a b/c#d'), 'https://masscom.kr/open#merchant=a%20b%2Fc%23d');
  // The showcase build has no https host of its own, so a link built for it uses its scheme (nothing shares it, see below).
  assert.equal(merchantLink('showcase-wolgye-MA010120220813334279', 'showcase'), 'masscom-demo://open#merchant=showcase-wolgye-MA010120220813334279');
});

test('reads the merchant id back, and only from our link', () => {
  assert.equal(parseMerchantLink('https://masscom.kr/open#merchant=showcase-wolgye-MA010120220813334279', 'production'), 'showcase-wolgye-MA010120220813334279');
  assert.equal(parseMerchantLink('masscom://open#merchant=m1', 'production'), 'm1');
  assert.equal(parseMerchantLink('masscom-demo://open#merchant=m1', 'showcase'), 'm1');
  for (const [url, variant] of [
    ['https://masscom.kr/open?merchant=m1', 'production'],
    ['https://masscom.kr/open#merchant=', 'production'],
    [`https://masscom.kr/open#merchant=${'x'.repeat(129)}`, 'production'],
    ['https://masscom.kr/open#merchant=a%00b', 'production'],
    ['https://evil.test/open#merchant=m1', 'production'],
    ['https://masscom.kr/open#friend=K7M2Q9XP', 'production'],
    // Another build's link is not ours to route.
    ['masscom-demo://open#merchant=m1', 'production'],
    ['https://masscom.kr/open#merchant=m1', 'showcase'],
  ] as const) assert.equal(parseMerchantLink(url, variant), undefined, `${variant} ${url}`);
  assert.equal(parseMerchantLink(`https://masscom.kr/open#merchant=${'x'.repeat(128)}`, 'production'), 'x'.repeat(128));
});

test('a merchant id becomes one safe route segment or nothing: no path, escape, space, control or dot segment', () => {
  const accepted = ['m1', 'showcase-wolgye-MA010120220809686086', '3f2b8c1e-5a4d-4f0e-9a7c-1b2d3e4f5a6b', '월계국밥', 'a.b', '.hidden', 'a..b', 'x'.repeat(128)];
  for (const id of accepted) assert.equal(isRoutableMerchantId(id), true, id);
  const refused = [
    '', '.', '..', '../../me/friends', 'a/b', '/a', 'a\\b', '%2e%2e', 'a%2Fb', 'a b', ' a', 'a ', 'a\tb', 'a\nb', 'a\u0000b',
    'a\u007fb', 'a\u0085b', 'a　b', 'a b', 'a​b', 'a‮b', 'x'.repeat(129),
  ];
  for (const id of refused) assert.equal(isRoutableMerchantId(id), false, JSON.stringify(id));
});

test('an id that decodes into a path is refused when it arrives in a link', () => {
  for (const encoded of ['..%2F..%2Fme%2Ffriends', '..%5C..%5Cme', '%2E%2E', '..', '.', 'a%252Fb', 'a%20b', 'a%09b', 'a%E3%80%80b']) {
    assert.equal(parseMerchantLink(`https://masscom.kr/open#merchant=${encoded}`, 'production'), undefined, encoded);
    assert.equal(parseMerchantLink(`masscom://open#merchant=${encoded}`, 'production'), undefined, encoded);
  }
});

test('the recommendation names the shop and the link, and says so when the shop is a demo shop', () => {
  const real = merchantShareMessage({ id: 'm1', name: '월계 국밥집', demo: false });
  assert.match(real, /월계 국밥집/);
  assert.ok(real.includes('https://masscom.kr/open#merchant=m1'));
  assert.doesNotMatch(real, /시연용 가상 점포/);
  const demo = merchantShareMessage({ id: 'showcase-wolgye-MA010120220813334279', name: '더까까주까월계역점', demo: true }, 'development');
  assert.match(demo, /더까까주까월계역점 \(공공데이터 가게 정보 · 방문은 체험용\)/);
  assert.ok(demo.includes('https://masscom.kr/open#merchant=showcase-wolgye-MA010120220813334279'));
});

test('the showcase recommendation names the shop and the download link, with no shop link that cannot open', () => {
  const message = merchantShareMessage({ id: 'showcase-wolgye-MA010120220813334279', name: '더까까주까월계역점', demo: true }, 'showcase');
  assert.match(message, /더까까주까월계역점 \(공공데이터 가게 정보 · 방문은 체험용\)/);
  assert.ok(message.endsWith('\n앱 받기: https://masscom.kr/open'));
  assert.doesNotMatch(message, /#merchant=|demo\.masscom\.kr|masscom-demo|showcase-a/);
});

test('a recommendation says nothing about visits: no date, stamp or count', () => {
  for (const variant of ['production', 'showcase', 'development'] as const) {
    const message = merchantShareMessage({ id: 'm1', name: '월계 국밥집', demo: false }, variant);
    assert.doesNotMatch(message, /방문|도장|번째|\d{4}/);
  }
});
