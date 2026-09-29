import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_LINK_ORIGIN, DEMO_LINK_ORIGIN, linkOriginFor, openLinkFragment } from './link';

test('the share origin follows the installed package, never a mutable flag', () => {
  assert.equal(DEFAULT_LINK_ORIGIN, 'https://masscom.kr');
  assert.equal(DEMO_LINK_ORIGIN, 'https://demo.masscom.kr');
  assert.equal(linkOriginFor('kr.masscom.wolgye'), DEFAULT_LINK_ORIGIN);
  assert.equal(linkOriginFor('kr.masscom.wolgye.dev'), DEFAULT_LINK_ORIGIN);
  assert.equal(linkOriginFor('kr.masscom.wolgye.demo'), DEMO_LINK_ORIGIN);
  assert.equal(linkOriginFor(null), DEFAULT_LINK_ORIGIN);
});

test('only our open link yields fragment values, and the query never counts', () => {
  assert.deepEqual(openLinkFragment('https://masscom.kr/open#a=1&b=two%20words'), { a: '1', b: 'two words' });
  assert.deepEqual(openLinkFragment('masscom://open#a=1'), { a: '1' });
  assert.deepEqual(openLinkFragment('https://masscom.kr/open?a=1'), {});
  assert.deepEqual(openLinkFragment('https://masscom.kr/open?a=1#b=2'), { b: '2' });
  assert.equal(openLinkFragment('https://example.com/open#a=1'), undefined);
  assert.equal(openLinkFragment('not a url'), undefined);
});

test('a fragment key that repeats keeps the first value and a broken escape drops only that pair', () => {
  assert.deepEqual(openLinkFragment('https://masscom.kr/open#a=1&a=2'), { a: '1' });
  assert.deepEqual(openLinkFragment('https://masscom.kr/open#a=%zz&b=2'), { b: '2' });
  assert.deepEqual(openLinkFragment('https://masscom.kr/open#&&=&b'), { b: '' });
});
