import assert from 'node:assert/strict';
import test from 'node:test';
import { addNaverRepository } from '../../plugins/with-naver-map-repository.cjs';

test('prebuild adds the official NAVER Maven repository once without replacing existing repositories', () => {
  const original = 'allprojects { repositories { google(); mavenCentral() } }';
  const updated = addNaverRepository(original);
  assert.ok(updated.startsWith(original));
  assert.match(updated, /maven \{ url 'https:\/\/repository\.map\.naver\.com\/archive\/maven' \}/);
  assert.equal(addNaverRepository(updated), updated);
});
