import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rejectReasonLooksPersonal } from './deletion-reject-reason.js';

test('plain operator reasons pass', () => {
  for (const reason of ['본인 확인이 되지 않는 요청', '중복 접수', '옛 접수라 다시 접수해 주세요', 'Duplicate request 2 of 2', '접수 3건 중 1건']) {
    assert.equal(rejectReasonLooksPersonal(reason), false, reason);
  }
});

test('emails, web addresses and phone-like numbers are refused, including after NFKC and with separators', () => {
  for (const reason of [
    'a@b.co', '연락처 user@example.com', 'https://example.com/me', 'www.example.kr', 'instagram.com/someone', '맛집.com',
    '01012345678', '010-1234-5678', '010 1234 5678', '010/1234/5678', '０１０－１２３４－５６７８', '010‐1234‐5678',
    '０１０１２３４５６７８', '＠', 'ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｃｏｍ',
    '0ㅡ1ㅡ0ㅡ1ㅡ2ㅡ3ㅡ4ㅡ5', '0ㅤ1ㅤ0ㅤ1ㅤ2ㅤ3ㅤ4ㅤ5',
  ]) {
    assert.equal(rejectReasonLooksPersonal(reason), true, reason);
  }
});

test('seven digits are not a long digit run', () => {
  assert.equal(rejectReasonLooksPersonal('1234567'), false);
  assert.equal(rejectReasonLooksPersonal('12345678'), true);
});
