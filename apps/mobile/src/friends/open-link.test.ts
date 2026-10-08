import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseOpenFragment, parseOpenLink, resolveOpenTarget } from './open-link';

test('routes a friend link and a merchant link, and nothing else', () => {
  assert.deepEqual(parseOpenLink('https://masscom.kr/open#friend=K7M2Q9XP', 'production'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(parseOpenLink('masscom://open#friend=k7m2-q9xp', 'production'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(parseOpenLink('https://masscom.kr/open#merchant=m1', 'production'), { kind: 'merchant', merchantId: 'm1' });
  for (const url of [
    'https://masscom.kr/open',
    'https://masscom.kr/open?friend=K7M2Q9XP',
    'https://masscom.kr/open#other=1',
    'https://evil.test/open#friend=K7M2Q9XP',
    '',
    null,
    undefined,
  ]) assert.deepEqual(parseOpenLink(url, 'production'), { kind: 'none' }, String(url));
});

test('a link that carries both prefers the friend code', () => {
  assert.deepEqual(parseOpenLink('https://masscom.kr/open#merchant=m1&friend=K7M2Q9XP', 'production'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(parseOpenLink('https://masscom.kr/open#friend=BAD&merchant=m1', 'production'), { kind: 'merchant', merchantId: 'm1' });
});

test('a malformed friend code goes to the friends tab with a notice instead of silently home', () => {
  for (const url of [
    'https://masscom.kr/open#friend=BADCODE',
    'masscom://open#friend=',
    'https://masscom.kr/open#friend=K7M2Q9X0',
    'https://masscom.kr/open#friend=K7M2-Q9X',
  ]) assert.deepEqual(parseOpenLink(url, 'production'), { kind: 'friend-problem', problem: 'MALFORMED' }, url);
});

test('another build\'s friend link goes to the friends tab with a notice and is never routed as a code', () => {
  assert.deepEqual(parseOpenLink('masscom-demo://open#friend=K7M2Q9XP', 'production'), { kind: 'friend-problem', problem: 'OTHER_APP' });
  assert.deepEqual(parseOpenLink('https://masscom.kr/open#friend=K7M2Q9XP', 'showcase'), { kind: 'friend-problem', problem: 'OTHER_APP' });
  assert.deepEqual(parseOpenLink('masscom://open#friend=K7M2Q9XP', 'development'), { kind: 'friend-problem', problem: 'OTHER_APP' });
  // Another build's link that names no friend code is simply not ours: home, as before.
  assert.deepEqual(parseOpenLink('masscom-demo://open#merchant=m1', 'production'), { kind: 'none' });
  assert.deepEqual(parseOpenLink('masscom-demo://open', 'production'), { kind: 'none' });
});

test('a merchant id that could walk the router is refused: the link goes home', () => {
  for (const id of ['..%2F..%2Fme%2Ffriends', '..', '.', 'a%2Fb', 'a%5Cb', 'a%2525b', 'a%20b', 'a%00b', 'a%09b', 'a%E3%80%80b']) {
    assert.deepEqual(parseOpenLink(`https://masscom.kr/open#merchant=${id}`, 'production'), { kind: 'none' }, id);
  }
  assert.deepEqual(parseOpenLink('https://masscom.kr/open#merchant=showcase-wolgye-MA010120220809686086', 'production'), {
    kind: 'merchant', merchantId: 'showcase-wolgye-MA010120220809686086',
  });
  assert.deepEqual(parseOpenLink('https://masscom.kr/open#merchant=3f2b8c1e-5a4d-4f0e-9a7c-1b2d3e4f5a6b', 'production'), {
    kind: 'merchant', merchantId: '3f2b8c1e-5a4d-4f0e-9a7c-1b2d3e4f5a6b',
  });
});

test('reads the fragment the router hands over without the leading #', () => {
  assert.deepEqual(parseOpenFragment('friend=K7M2Q9XP'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(parseOpenFragment('#friend=K7M2Q9XP'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(parseOpenFragment('merchant=m1'), { kind: 'merchant', merchantId: 'm1' });
  assert.deepEqual(parseOpenFragment('friend=BADCODE'), { kind: 'friend-problem', problem: 'MALFORMED' });
  assert.deepEqual(parseOpenFragment('merchant=..%2F..%2Fme%2Ffriends'), { kind: 'none' });
  assert.deepEqual(parseOpenFragment(''), { kind: 'none' });
  assert.deepEqual(parseOpenFragment(undefined), { kind: 'none' });
});

test('the full link wins, and the router fragment covers a platform that only hands over the route', () => {
  assert.deepEqual(resolveOpenTarget('https://masscom.kr/open#friend=K7M2Q9XP', undefined, 'production'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(resolveOpenTarget('https://masscom.kr/open#merchant=m1', 'friend=K7M2Q9XP', 'production'), { kind: 'merchant', merchantId: 'm1' });
  // Android may deliver the link with its fragment stripped while the router still parsed it into the route.
  assert.deepEqual(resolveOpenTarget('https://masscom.kr/open', 'friend=K7M2Q9XP', 'production'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(resolveOpenTarget(null, 'merchant=m1', 'production'), { kind: 'merchant', merchantId: 'm1' });
  assert.deepEqual(resolveOpenTarget(null, undefined, 'production'), { kind: 'none' });
  assert.deepEqual(resolveOpenTarget('https://masscom.kr/open', undefined, 'production'), { kind: 'none' });
});

test('the router fragment is read for every build, since the OS only routes a build its own links', () => {
  assert.deepEqual(resolveOpenTarget('masscom-demo://open', 'friend=K7M2Q9XP', 'showcase'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(resolveOpenTarget(null, 'friend=K7M2Q9XP', 'development'), { kind: 'friend', code: 'K7M2Q9XP' });
});

test('a usable target beats a problem, and a problem beats nothing', () => {
  assert.deepEqual(resolveOpenTarget('masscom-demo://open#friend=K7M2Q9XP', undefined, 'production'), { kind: 'friend-problem', problem: 'OTHER_APP' });
  assert.deepEqual(resolveOpenTarget('https://masscom.kr/open', 'friend=BAD', 'production'), { kind: 'friend-problem', problem: 'MALFORMED' });
  // A delivered link that names no MassCOM link at all leaves the router fragment as the only word on the matter.
  assert.deepEqual(resolveOpenTarget('https://evil.test/open#friend=K7M2Q9XP', 'friend=23456789', 'production'), { kind: 'friend', code: '23456789' });
});

test('another build\'s link stays that build\'s: the router fragment of the same link never turns its code into ours', () => {
  const foreign = { kind: 'friend-problem', problem: 'OTHER_APP' } as const;
  // The router parses the fragment out of the very link it was handed, so the fragment repeats the foreign code.
  assert.deepEqual(resolveOpenTarget('masscom-demo://open#friend=K7M2Q9XP', 'friend=K7M2Q9XP', 'production'), foreign);
  assert.deepEqual(resolveOpenTarget('masscom-demo://open#friend=K7M2Q9XP', 'friend=23456789', 'production'), foreign);
  assert.deepEqual(resolveOpenTarget('masscom://open#friend=K7M2Q9XP', 'friend=K7M2Q9XP', 'showcase'), foreign);
  assert.deepEqual(resolveOpenTarget('https://masscom.kr/open#friend=K7M2Q9XP', 'friend=K7M2Q9XP', 'showcase'), foreign);
  assert.deepEqual(resolveOpenTarget('masscom://open#friend=K7M2Q9XP', 'friend=K7M2Q9XP', 'development'), foreign);
  assert.deepEqual(resolveOpenTarget('masscom-demo://open#friend=K7M2Q9XP', 'friend=K7M2Q9XP', 'development'), foreign);
  assert.deepEqual(resolveOpenTarget('masscom-dev://open#friend=K7M2Q9XP', 'friend=K7M2Q9XP', 'production'), foreign);
  // Another build's link that names no friend code is simply not ours either: home, whatever the fragment says.
  assert.deepEqual(resolveOpenTarget('masscom-demo://open#merchant=m1', 'friend=K7M2Q9XP', 'production'), { kind: 'none' });
  // Production and development share the public https link, so it is theirs and the fragment is read as before.
  assert.deepEqual(resolveOpenTarget('https://masscom.kr/open', 'friend=K7M2Q9XP', 'development'), { kind: 'friend', code: 'K7M2Q9XP' });
});
