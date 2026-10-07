import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./center.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/notifications.tsx', import.meta.url), 'utf8');

test('notification loader handles retry rejection and shows empty only after a successful load', () => {
  assert.match(source, /const \[loading, setLoading\] = useState\(true\)/);
  assert.match(source, /const load = useCallback\(async \(isCurrent:[\s\S]*?try \{[\s\S]*?catch \{[\s\S]*?finally \{ if \(isCurrent\(\)\) setLoading\(false\); \}/);
  assert.match(source, /!loading && !error && items\.length === 0/);
  assert.doesNotMatch(source, /!prefs \? <ActivityIndicator \/>/);
});

test('each notification setting switch has a distinct accessible name', () => {
  assert.match(source, /<Switch accessibilityLabel="휴대폰 푸시 알림 받기"/);
  assert.match(source, /<Switch accessibilityLabel=\{title\}/);
});

test('notification route forwards session invalidation to center', () => {
  assert.match(route, /<NotificationCenter[^>]*onSessionInvalid=\{auth\.invalidateSession\}/);
});
