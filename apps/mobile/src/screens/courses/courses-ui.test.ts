import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
const claim = readFileSync(new URL('../claim-redeem/index.tsx', import.meta.url), 'utf8');

test('course unlock is offered only for READY server state and scene is hidden for STALE', () => {
  assert.match(source, /course\.state !== 'READY' \|\| course\.done !== course\.total/);
  assert.match(source, /course\.state === 'UNLOCKED' && sceneOpen/);
  assert.match(source, /await api\.unlock\(course\.id\)/);
});

test('scene uses each step own coin thumbnail and claim follows up with one course read', () => {
  assert.match(source, /step\.artwork\.thumbnailDataUrl/);
  assert.match(source, /course\.sceneKey/);
  assert.match(claim, /createCourseApiClient\(\{ apiUrl, credential, onSessionInvalid \}\)\.list\(controller\.signal\)/);
  assert.match(claim, /코스 다시 불러오기/);
});

test('consent refusal leads to the shared recheck flow and changing detail ids hides old data', () => {
  assert.match(source, /needsConsentRecheck\(cause\)/);
  assert.match(source, /errorNeedsConsent \? recheckConsent/);
  assert.match(source, /courses\?\.\[0\]\?\.id === courseId/);
});

test('404 or 410 on refreshed detail clears cached detail and any open scene', () => {
  assert.match(source, /const cleared = courseId && clearedCourseDetail\(cause\);\s*if \(cleared\) \{ setCourses\(cleared\.courses\); setSceneOpen\(cleared\.sceneOpen\); \}/);
  assert.match(source, /step\.state === 'UNAVAILABLE' \? '지금은 이용할 수 없는 가게예요'/);
});

test('older APIs without courses leave claim success free of course error banner', () => {
  assert.match(claim, /if \(courseListIsNotConfigured\(cause\)\) \{\s*setNextCourse\(undefined\);\s*setCourseReadError\(undefined\);/);
});
