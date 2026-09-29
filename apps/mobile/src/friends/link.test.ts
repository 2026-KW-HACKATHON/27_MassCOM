import assert from 'node:assert/strict';
import { test } from 'node:test';

import { APP_DOWNLOAD_LINK, DEFAULT_LINK_ORIGIN, linkVariantFor, openLinkBase, openLinkFragment, readOpenLink } from './link';

test('the build is told apart by its installed package, never by a mutable flag', () => {
  assert.equal(DEFAULT_LINK_ORIGIN, 'https://masscom.kr');
  assert.equal(APP_DOWNLOAD_LINK, 'https://masscom.kr/open');
  assert.equal(linkVariantFor('kr.masscom.wolgye'), 'production');
  assert.equal(linkVariantFor('kr.masscom.wolgye.demo'), 'showcase');
  assert.equal(linkVariantFor('kr.masscom.wolgye.dev'), 'development');
  // Anything else is treated as development: it never claims the production or showcase links.
  assert.equal(linkVariantFor('kr.example.other'), 'development');
  assert.equal(linkVariantFor(null), 'development');
  assert.equal(linkVariantFor(undefined), 'development');
});

test('production and development write the public https link into their QR; the showcase build writes its own scheme', () => {
  assert.equal(openLinkBase('production'), 'https://masscom.kr/open');
  assert.equal(openLinkBase('development'), 'https://masscom.kr/open');
  // demo.masscom.kr has no DNS, web-server block or assetlinks entry yet, so no https link is ever built for the showcase build.
  assert.equal(openLinkBase('showcase'), 'masscom-demo://open');
  assert.doesNotMatch(openLinkBase('showcase'), /^https?:/);
});

test('only our open link yields fragment values, and the query never counts', () => {
  assert.deepEqual(openLinkFragment('https://masscom.kr/open#a=1&b=two%20words', 'production'), { a: '1', b: 'two words' });
  assert.deepEqual(openLinkFragment('masscom://open#a=1', 'production'), { a: '1' });
  assert.deepEqual(openLinkFragment('https://masscom.kr/open?a=1', 'production'), {});
  assert.deepEqual(openLinkFragment('https://masscom.kr/open?a=1#b=2', 'production'), { b: '2' });
  assert.equal(openLinkFragment('https://example.com/open#a=1', 'production'), undefined);
  assert.equal(openLinkFragment('not a url', 'production'), undefined);
});

test('a fragment key that repeats keeps the first value and a broken escape drops only that pair', () => {
  assert.deepEqual(openLinkFragment('https://masscom.kr/open#a=1&a=2', 'production'), { a: '1' });
  assert.deepEqual(openLinkFragment('https://masscom.kr/open#a=%zz&b=2', 'production'), { b: '2' });
  assert.deepEqual(openLinkFragment('https://masscom.kr/open#&&=&b', 'production'), { b: '' });
});

test('each build accepts only its own hosts and scheme', () => {
  const accepted = {
    production: ['https://masscom.kr/open#a=1', 'https://www.masscom.kr/open#a=1', 'masscom://open#a=1', 'masscom:///open#a=1'],
    showcase: ['https://demo.masscom.kr/open#a=1', 'masscom-demo://open#a=1', 'masscom-demo:///open#a=1'],
    development: ['https://masscom.kr/open#a=1', 'https://www.masscom.kr/open#a=1', 'masscom-dev://open#a=1', 'masscom-dev:///open#a=1'],
  } as const;
  const everyLink = [...new Set(Object.values(accepted).flat())];
  for (const variant of ['production', 'showcase', 'development'] as const) {
    for (const url of everyLink) {
      const expected = (accepted[variant] as readonly string[]).includes(url) ? { a: '1' } : undefined;
      assert.deepEqual(openLinkFragment(url, variant), expected, `${variant} ${url}`);
    }
  }
});

test('a MassCOM link of another build is recognised as such, so its code is never treated as ours', () => {
  assert.deepEqual(readOpenLink('masscom-demo://open#friend=K7M2Q9XP', 'production'), { ours: false, fragment: { friend: 'K7M2Q9XP' } });
  assert.deepEqual(readOpenLink('https://demo.masscom.kr/open#friend=K7M2Q9XP', 'production'), { ours: false, fragment: { friend: 'K7M2Q9XP' } });
  assert.deepEqual(readOpenLink('https://masscom.kr/open#friend=K7M2Q9XP', 'showcase'), { ours: false, fragment: { friend: 'K7M2Q9XP' } });
  assert.deepEqual(readOpenLink('masscom://open#friend=K7M2Q9XP', 'showcase'), { ours: false, fragment: { friend: 'K7M2Q9XP' } });
  assert.deepEqual(readOpenLink('masscom://open#friend=K7M2Q9XP', 'development'), { ours: false, fragment: { friend: 'K7M2Q9XP' } });
  assert.deepEqual(readOpenLink('masscom-dev://open#friend=K7M2Q9XP', 'production'), { ours: false, fragment: { friend: 'K7M2Q9XP' } });
  assert.deepEqual(readOpenLink('masscom://open#friend=K7M2Q9XP', 'production'), { ours: true, fragment: { friend: 'K7M2Q9XP' } });
  // The public https link belongs to both production and development, which share the host.
  assert.equal(readOpenLink('https://masscom.kr/open#x=1', 'production')?.ours, true);
  assert.equal(readOpenLink('https://masscom.kr/open#x=1', 'development')?.ours, true);
  // Anything that is not a MassCOM open link is not recognised at all.
  for (const other of ['https://evil.test/open#friend=K7M2Q9XP', 'https://masscom.kr/other#friend=K7M2Q9XP', 'other://open#friend=K7M2Q9XP', 'K7M2Q9XP']) {
    assert.equal(readOpenLink(other, 'production'), undefined, other);
  }
});
