import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('each required box is a checkbox that tells assistive technology whether it is checked', () => {
  assert.match(screen, /consentChecks\.map/);
  assert.match(screen, /accessibilityRole="checkbox"/);
  assert.match(screen, /accessibilityLabel=\{check\.label\}/);
  assert.match(screen, /accessibilityState=\{\{ checked, disabled: busy \}\}/);
  // The drawn box is decoration; the row is the control.
  assert.match(screen, /accessible=\{false\} importantForAccessibility="no-hide-descendants"/);
});

test('links are links with a hint, and a failed open is shown instead of swallowed', () => {
  assert.match(screen, /accessibilityRole="link"/);
  assert.match(screen, /accessibilityHint=\{check\.link\.hint\}/);
  assert.match(screen, /Linking\.openURL\(url\)/);
  assert.match(screen, /consentCopy\.openLinkFailed/);
});

test('the start button is disabled and says so until all three are checked, then records once', () => {
  assert.match(screen, /const ready = canSubmitConsent\(checks\)/);
  assert.match(screen, /accessibilityState=\{\{ disabled: !ready \|\| busy, busy \}\}/);
  assert.match(screen, /disabled=\{!ready \|\| busy\}/);
  assert.match(screen, /if \(busy \|\| !ready\) return;/);
  assert.match(screen, /consentCopy\.submit\b/);
  assert.match(screen, /submitConsent\(client, credential, checks\)/);
});

test('the screen never leaves the user stuck: retry after a failed check, sign-out always', () => {
  assert.match(screen, /consentCopy\.retry/);
  assert.match(screen, /consentCopy\.logout/);
  assert.match(screen, /onLogout\(\)/);
  assert.match(screen, /onSessionInvalid\(\)/);
  assert.match(screen, /gate\.kind === 'outdated' \? consentCopy\.versionMismatch : consentCopy\.checkFailed/);
});

test('status and errors are announced politely, the page scrolls and text is never capped', () => {
  assert.match(screen, /accessibilityLiveRegion="polite"/);
  assert.match(screen, /<SkyScrollView/);
  assert.match(screen, /accessibilityRole="header"/);
  assert.doesNotMatch(screen, /allowFontScaling=\{false\}|maxFontSizeMultiplier/);
  // Nothing about consent is kept on the device: the server is the record.
  assert.doesNotMatch(screen, /AsyncStorage|SecureStore|localStorage/);
});

test('the notice shows all four items above the boxes', () => {
  assert.match(screen, /consentNotice\.map/);
  assert.ok(screen.indexOf('consentNotice.map') < screen.indexOf('consentChecks.map'));
  assert.match(screen, /consentCopy\.noticeTitle/);
});
