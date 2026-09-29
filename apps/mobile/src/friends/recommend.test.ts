import assert from 'node:assert/strict';
import { test } from 'node:test';

import { merchantLink, merchantShareMessage, parseMerchantLink } from './recommend';

test('builds the merchant link with the id escaped in the fragment', () => {
  assert.equal(merchantLink('showcase-a'), 'https://masscom.kr/open#merchant=showcase-a');
  assert.equal(merchantLink('a b/c#d', 'https://demo.masscom.kr'), 'https://demo.masscom.kr/open#merchant=a%20b%2Fc%23d');
});

test('reads the merchant id back, escapes included, and only from our link', () => {
  assert.equal(parseMerchantLink('https://masscom.kr/open#merchant=showcase-a'), 'showcase-a');
  assert.equal(parseMerchantLink(merchantLink('a b/c#d')), 'a b/c#d');
  assert.equal(parseMerchantLink('masscom://open#merchant=m1'), 'm1');
  for (const url of [
    'https://masscom.kr/open?merchant=m1',
    'https://masscom.kr/open#merchant=',
    `https://masscom.kr/open#merchant=${'x'.repeat(129)}`,
    'https://masscom.kr/open#merchant=a%00b',
    'https://evil.test/open#merchant=m1',
    'https://masscom.kr/open#friend=K7M2Q9XP',
  ]) assert.equal(parseMerchantLink(url), undefined, url);
});

test('the recommendation names the shop and the link, and says so when the shop is a demo shop', () => {
  const real = merchantShareMessage({ id: 'm1', name: '월계 국밥집', demo: false });
  assert.match(real, /월계 국밥집/);
  assert.ok(real.includes('https://masscom.kr/open#merchant=m1'));
  assert.doesNotMatch(real, /시연용 가상 점포/);
  const demo = merchantShareMessage({ id: 'showcase-a', name: '가상 점포 A', demo: true }, 'https://demo.masscom.kr');
  assert.match(demo, /가상 점포 A \(시연용 가상 점포\)/);
  assert.ok(demo.includes('https://demo.masscom.kr/open#merchant=showcase-a'));
});

test('a recommendation says nothing about visits: no date, stamp or count', () => {
  const message = merchantShareMessage({ id: 'm1', name: '월계 국밥집', demo: false });
  assert.doesNotMatch(message, /방문|도장|번째|\d{4}/);
});
