import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('play and studio consent actions ask the existing root gate to re-check', () => {
  const layout = source('../app/_layout.tsx');
  assert.match(layout, /const recheckConsent = useCallback\(\(\) => setConsentedAccountId\(undefined\), \[\]\)/);
  assert.match(layout, /<ConsentRecheckProvider onRecheck=\{recheckConsent\}><Routes \/><\/ConsentRecheckProvider>/);

  for (const path of ['../screens/play/index.tsx', '../screens/play/game-session.tsx', '../screens/studio/index.tsx', '../screens/studio/friend.tsx']) {
    const screen = source(path);
    assert.match(screen, /useConsentRecheck\(\)/, path);
    assert.match(screen, /needsConsentRecheck\(/, path);
    assert.match(screen, /consentRecheckLabel/, path);
    assert.match(screen, /onPress=\{recheckConsent\}|onPress=\{errorNeedsConsent \? recheckConsent :|onPress: errorNeedsConsent \? recheckConsent/, path);
  }
});
