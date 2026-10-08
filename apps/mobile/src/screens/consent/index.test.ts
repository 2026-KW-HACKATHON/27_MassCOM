import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { consentSummary } from '../../privacy/consent-copy';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('each required box is a checkbox that tells assistive technology whether it is checked', () => {
  assert.match(screen, /consentChecks\.map/);
  assert.match(screen, /accessibilityRole="checkbox"/);
  assert.match(screen, /accessibilityLabel=\{check\.label\}/);
  assert.match(screen, /accessibilityState=\{\{ checked, disabled: busy \}\}/);
  // The drawn box is decoration; the row is the control.
  assert.match(screen, /accessible=\{false\} importantForAccessibility="no-hide-descendants"/);
});

test('on the web each checkbox exposes aria-checked and Space toggles it like Enter does', () => {
  // react-native-web ignores accessibilityState, so aria-checked is the only thing that reaches the DOM.
  assert.match(screen, /aria-checked=\{checked\}/);
  assert.match(screen, /onPress=\{toggle\}/);
  // Space handler is web-only (native unchanged); the shared helper's own test covers repeat and scroll prevention.
  assert.match(screen, /\{\.\.\.\(Platform\.OS === 'web' \? \{ onKeyDown: spaceToggles\(toggle\) \} : \{\}\)\}/);
  assert.match(screen, /import \{ spaceToggles \} from '@\/ui\/space-toggles';/);
  // A busy screen never toggles, whichever key got there.
  assert.match(screen, /const toggle = \(\) => \{ if \(!busy\) setChecks/);
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

test('button labels span their buttons so a narrow Android measurement cannot clip them (#271)', () => {
  const start = screen.indexOf('<Text\n          numberOfLines={2}');
  assert.ok(start > 0, 'the start button label keeps numberOfLines={2}');
  const label = screen.slice(start, screen.indexOf('</Text>', start));
  // The label uses the stretched style; wraps instead of clipping; never shrinks or caps the text; no remount key.
  assert.match(label, /style=\{\[styles\.submitText,/);
  assert.doesNotMatch(label, /adjustsFontSizeToFit|allowFontScaling|maxFontSizeMultiplier|key=/);
  const styles = readFileSync(new URL('./styles.ts', import.meta.url), 'utf8');
  const block = (name: string) => styles.match(new RegExp(`\\b${name}: \\{[^}]*\\}`))?.[0] ?? '';
  // Samsung One UI measured the 900-weight label at 260px but drew it at ~300px; a full-width box stays centred.
  for (const name of ['submitText', 'secondaryText']) {
    assert.match(block(name), /alignSelf: 'stretch'/, `${name} spans its button`);
    assert.match(block(name), /textAlign: 'center'/, `${name} stays centred`);
  }
  assert.match(styles, /submitTextDisabled: \{ color: palette\.secondaryLabel \}/);
});

test('the screen never leaves the user stuck: retry after a failed check, sign-out always', () => {
  assert.match(screen, /consentCopy\.retry/);
  assert.match(screen, /consentCopy\.logout/);
  assert.match(screen, /finishConsentLogout\(onLogout\)/);
  assert.match(screen, /onSessionInvalid\(\)/);
  assert.match(screen, /gate\.kind === 'outdated' \? consentCopy\.versionMismatch : consentCopy\.checkFailed/);
  // Where the user has not refused anything (a failed check, an outdated app) sign-out is not called "not agreeing".
  const failedBranch = screen.slice(screen.indexOf("gate.kind === 'failed' || gate.kind === 'outdated'"), screen.indexOf('<Text accessibilityRole="header" selectable style={styles.title}>'));
  assert.match(failedBranch, /consentCopy\.logoutNeutral/);
  assert.doesNotMatch(failedBranch, /consentCopy\.logout\b/);
  const formBranch = screen.slice(screen.indexOf('<Text accessibilityRole="header" selectable style={styles.title}>'));
  assert.match(formBranch, /consentCopy\.logout\b/);
});

test('status and errors are announced politely, the page scrolls and text is never capped', () => {
  assert.match(screen, /accessibilityLiveRegion="polite"/);
  assert.match(screen, /<SkyScrollView/);
  assert.match(screen, /accessibilityRole="header"/);
  assert.doesNotMatch(screen, /allowFontScaling=\{false\}|maxFontSizeMultiplier/);
  // Nothing about consent is kept on the device: the server is the record.
  assert.doesNotMatch(screen, /AsyncStorage|SecureStore|localStorage/);
});

test('the check box grows with the system font scale instead of capping the text', () => {
  assert.match(screen, /consentBoxSize\(useWindowDimensions\(\)\.fontScale\)/);
  assert.match(screen, /\{ width: boxSize, height: boxSize, minWidth: boxSize, minHeight: boxSize \}/);
});

test('the full four-item notice (collapsed under 자세히 보기) and the always-visible summary both come before the boxes', () => {
  assert.match(screen, /consentNotice\.map/);
  assert.ok(screen.indexOf('consentNotice.map') < screen.indexOf('consentChecks.map'));
  assert.match(screen, /consentCopy\.noticeTitle/);
  // The summary is not behind the toggle: it is rendered before the `detailsOpen` conditional and covers the mandatory items.
  assert.ok(screen.indexOf('consentSummary.map') < screen.indexOf('{detailsOpen ? ('), 'summary is always rendered');
  assert.deepEqual(consentSummary.map((item) => item.heading), ['목적·항목', '보유 기간', '동의하지 않으면']);
  // The full notice stays unmounted while collapsed, on purpose, and the code says why.
  assert.match(screen, /전체 안내는 접힌 동안 렌더하지 않는다\(의도\)/);
});

test('a three-line summary comes first, and the full notice sits behind a collapsed 자세히 보기 that exposes aria-expanded', () => {
  assert.match(screen, /consentSummary\.map/);
  assert.ok(screen.indexOf('consentSummary.map') < screen.indexOf('consentNotice.map'), 'summary before the full notice');
  assert.match(screen, /const \[detailsOpen, setDetailsOpen\] = useState\(false\)/, 'collapsed by default');
  assert.match(screen, /aria-expanded=\{detailsOpen\}/);
  assert.match(screen, /accessibilityState=\{\{ expanded: detailsOpen \}\}/);
  assert.match(screen, /accessibilityLabel=\{consentCopy\.details\}/);
  assert.match(screen, /\{detailsOpen \? \(\s*<View style=\{styles\.detailsGroup\}>\s*\{consentNotice\.map/, 'the notice only shows when expanded');
  assert.ok(screen.indexOf('aria-expanded') < screen.indexOf('consentChecks.map'), 'the toggle sits above the boxes');
});

test('전체 동의 is a checkbox with a mixed state, aria-checked and a web-only Space handler, driven by the pure consent-flow functions', () => {
  assert.match(screen, /accessibilityLabel=\{consentCopy\.agreeAll\}/);
  assert.match(screen, /const masterChecked = masterConsentState\(checks\);/);
  assert.match(screen, /aria-checked=\{masterChecked\}/);
  assert.match(screen, /accessibilityState=\{\{ checked: masterChecked, disabled: busy \}\}/);
  assert.match(screen, /onPress=\{toggleAll\}/);
  assert.match(screen, /\{\.\.\.\(Platform\.OS === 'web' \? \{ onKeyDown: spaceToggles\(toggleAll\) \} : \{\}\)\}/);
  // A busy screen never toggles; the toggle writes through the pure function, so the required keys come from the copy table.
  assert.match(screen, /const toggleAll = \(\) => \{ if \(!busy\) setChecks\(toggleAllConsent\); \};/);
  // The mixed state is drawn (a dash) as well as announced.
  assert.match(screen, /masterChecked === 'mixed' \? '–' : masterChecked \? '✓' : ''/);
  // The summary sits above the master box, the master box above the individual rows, which stay under their own label.
  assert.ok(screen.indexOf('consentSummary.map') < screen.indexOf('consentCopy.agreeAll'), 'summary above 전체 동의');
  assert.ok(screen.indexOf('consentCopy.agreeAll') < screen.indexOf('consentCopy.individualHeading'));
  assert.ok(screen.indexOf('consentCopy.individualHeading') < screen.indexOf('consentChecks.map'));
  // Submit still sends the three checks as they are.
  assert.match(screen, /submitConsent\(client, credential, checks\)/);
});
