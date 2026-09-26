import assert from 'node:assert/strict';
import test from 'node:test';

import { accountContextLabel } from './app-context';

test('installed package labels the account context without calling a showcase account operating', () => {
  assert.equal(accountContextLabel('kr.masscom.wolgye.demo'), '체험용 계정');
  assert.equal(accountContextLabel('kr.masscom.wolgye.dev'), '개발용 계정');
  assert.equal(accountContextLabel('kr.masscom.wolgye'), '운영 계정');
  assert.equal(accountContextLabel(null), '운영 계정');
});
