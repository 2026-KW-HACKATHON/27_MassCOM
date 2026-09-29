import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseOpenFragment, parseOpenLink } from './open-link';

test('routes a friend link and a merchant link, and nothing else', () => {
  assert.deepEqual(parseOpenLink('https://masscom.kr/open#friend=K7M2Q9XP'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(parseOpenLink('masscom://open#friend=k7m2-q9xp'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(parseOpenLink('https://masscom.kr/open#merchant=m1'), { kind: 'merchant', merchantId: 'm1' });
  for (const url of [
    'https://masscom.kr/open',
    'https://masscom.kr/open?friend=K7M2Q9XP',
    'https://masscom.kr/open#friend=BADCODE',
    'https://masscom.kr/open#other=1',
    'https://evil.test/open#friend=K7M2Q9XP',
    '',
    null,
    undefined,
  ]) assert.deepEqual(parseOpenLink(url), { kind: 'none' }, String(url));
});

test('a link that carries both prefers the friend code', () => {
  assert.deepEqual(parseOpenLink('https://masscom.kr/open#merchant=m1&friend=K7M2Q9XP'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(parseOpenLink('https://masscom.kr/open#friend=BAD&merchant=m1'), { kind: 'merchant', merchantId: 'm1' });
});

test('reads the fragment the router hands over without the leading #', () => {
  assert.deepEqual(parseOpenFragment('friend=K7M2Q9XP'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(parseOpenFragment('#friend=K7M2Q9XP'), { kind: 'friend', code: 'K7M2Q9XP' });
  assert.deepEqual(parseOpenFragment('merchant=m1'), { kind: 'merchant', merchantId: 'm1' });
  assert.deepEqual(parseOpenFragment(''), { kind: 'none' });
  assert.deepEqual(parseOpenFragment(undefined), { kind: 'none' });
});
