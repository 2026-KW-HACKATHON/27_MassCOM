import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const provider = read('discovery/discovery-provider.tsx');
const layout = read('app/_layout.tsx');
const settings = read('screens/account-settings/index.tsx');
const entry = read('ui/experience-entry.tsx');

test('one provider sits above the routes and the showcase merchant screen, so every profile strip shares it', () => {
  const account = layout.slice(layout.indexOf('function AccountAppearance()'), layout.indexOf('function AuthenticatedRoot()'));
  assert.match(account, /<TabAppearanceProvider accountId=\{auth\.accountId\}>\s*<DiscoveryProvider\s+apiUrl=\{publicApiConfig\.available \? publicApiConfig\.apiUrl : undefined\}\s+accountId=\{auth\.accountId\}\s+credential=\{auth\.credential\}\s+onSessionInvalid=\{auth\.invalidateSession\}\s*>\s*<AuthenticatedRoot \/>/);
  assert.equal((layout.match(/<DiscoveryProvider/g) ?? []).length, 1);
});

test('a screen gaining focus asks for the strip alone; the stage answers come from Home\'s own load and from a claim, and only while a door could still open', () => {
  assert.match(provider, /const refresh = useCallback\(\(\) => \{ if \(calls\) void calls\.loadStrip\(\)\.catch\(ignore\); \}, \[calls\]\);/);
  assert.match(provider, /const regular = stage === 'regular';/);
  assert.match(provider, /const refreshStage = useCallback\(\(\) => \{ if \(calls && !regular\) void calls\.loadStage\(\)\.catch\(ignore\); \}, \[calls, regular\]\);/);
  // refresh (the focus path) never names the stage answers.
  const refresh = provider.slice(provider.indexOf('const refresh = useCallback'), provider.indexOf('const refreshStage = useCallback'));
  assert.doesNotMatch(refresh, /loadStage|loadCollection|loadCoinShop/);
  // A claim asks right after it succeeds, on both success paths.
  const claim = read('screens/claim-redeem/index.tsx');
  assert.match(claim, /const \{ refreshStage \} = useDiscovery\(\);/);
  assert.equal((claim.match(/refreshStage\(\);/g) ?? []).length, 2, 'code redeem and test visit');
});

test('the override can force the stage and never reaches the saved record', () => {
  assert.match(provider, /useSyncExternalStore\(subscribeDisclosureOverride, isDisclosureForced/);
  assert.match(provider, /const stage = forced \? 'regular' : furtherStage\(record\.reached, real\.stage\);/);
  assert.match(provider, /const optIn = forced \? forcedOptIn : real\.optIn;/);
  assert.match(provider, /if \(loadedRecord && !forced\)/);
});

test('a stage raised in the very render the saved record arrived in is still written: the load remembers what storage holds', () => {
  assert.match(provider, /stored\.current = \{ key: accountId, record: loaded \};\s*setSaved\(\{ key: accountId, record: loaded \}\);/);
  assert.match(provider, /!saved \|\| saved\.key !== accountId \|\| !held \|\| held\.key !== accountId \|\| sameDisclosureRecord\(held\.record, saved\.record\)\) return;/);
  assert.match(provider, /void saveDisclosureRecord\(AsyncStorage, accountId, saved\.record\);/);
  // The old guess ("the first value seen is what storage holds") is gone.
  assert.doesNotMatch(provider, /lastSeen/);
});

test('nothing is written before the account\'s record has been read, and the switches wait for it', () => {
  assert.match(provider, /const ready = loadedRecord !== undefined;/);
  const setter = provider.slice(provider.indexOf('const setOptIn = useCallback'), provider.indexOf('const loadCollection = useCallback'));
  assert.match(setter, /if \(!current \|\| current\.key !== accountId\) return false;/);
  assert.ok(setter.indexOf('return false;') < setter.indexOf('saveDisclosureRecord'));
  assert.match(setter, /\}, \[accountId\]\);/, 'one identity for the whole account, so the friends tab is not rebuilt when the record moves');
  assert.match(settings, /disabled=\{optInBusy \|\| discovery\.forced \|\| !discovery\.ready\}/);
});

test('existing social users keep their doors: friends are counted into the opt-in, and adding a friend opts in', () => {
  assert.match(provider, /const chosen = useMemo\(\(\) => resolveOptIn\(record\.optIn, strip\.friendCount\), \[record\.optIn, strip\.friendCount\]\);/);
  assert.match(provider, /optedIn: chosen/);
  assert.match(provider, /withProgress\(loadedRecord, real\.stage, strip\.friendCount\)/);
  const friends = read('screens/friends/index.tsx');
  assert.match(friends, /const result = await api\.addFriend\(code\);[\s\S]*?void setOptIn\(\{ social: true \}\);/);
  assert.match(read('screens/room-explore/index.tsx'), /added = await client\.addFriend\(roomId\)[\s\S]*?void setOptIn\(\{ social: true \}\);/);
});

test('the saved record is per account', () => {
  assert.match(provider, /loadDisclosureRecord\(AsyncStorage, accountId\)/);
  assert.match(provider, /saveDisclosureRecord\(AsyncStorage, accountId,/);
});

test('Settings 더 즐기기 lists friends/mail and play as labelled switches and keeps the friends and notification links', () => {
  assert.match(settings, /<Text accessibilityRole="header" style=\{styles\.sectionTitle\}>더 즐기기<\/Text>/);
  assert.match(settings, /label="친구·쪽지"[\s\S]*?checked=\{discovery\.optIn\.social\}[\s\S]*?chooseOptIn\(\{ social: !discovery\.optIn\.social \}\)/);
  assert.match(settings, /label="놀이"[\s\S]*?checked=\{discovery\.optIn\.play\}[\s\S]*?chooseOptIn\(\{ play: !discovery\.optIn\.play \}\)/);
  const row = settings.slice(settings.indexOf('function OptInRow'), settings.indexOf('function InfoCard'));
  assert.match(row, /accessibilityRole="switch"/);
  assert.match(row, /accessibilityState=\{\{ checked, disabled \}\}/);
  assert.match(row, /aria-checked=\{checked\}/);
  assert.match(row, /spaceToggles\(/);
  // The visual state pill is hidden from assistive tech: the switch itself already says checked.
  assert.match(row, /accessible=\{false\} importantForAccessibility="no-hide-descendants"/);
  assert.match(settings, /<Link href="\/friends" asChild>/);
  assert.match(settings, /<Link href=\{'\/notifications' as never\} asChild>/);
  assert.match(settings, /accessibilityLiveRegion="polite"[\s\S]*?discovery\.error/);
  assert.match(settings, /disabled=\{optInBusy \|\| discovery\.forced \|\| !discovery\.ready\}/);
});

test('도감 entries: room after the first coin, the play hint from the first coin on (it stays for a regular who never opted in), nothing drawn before', () => {
  assert.match(entry, /const showRoom = atLeast\(stage, 'after-first'\);/);
  assert.match(entry, /const showPlay = optIn\.play \|\| stage !== 'first-coin';/);
  assert.match(entry, /if \(!showRoom && !showPlay\) return null;/);
  // Pressing the hint is the person's own opt-in, then it opens the games.
  assert.match(entry, /if \(!optIn\.play\) void setOptIn\(\{ play: true \}\); router\.push\('\/play'\);/);
});

test('the QA switch is typed and CI builds leave it unset', () => {
  assert.match(read('types/env.d.ts'), /EXPO_PUBLIC_DISCLOSURE\?: string;/);
  assert.match(read('discovery/disclosure-override.ts'), /forcedByEnv\(process\.env\.EXPO_PUBLIC_DISCLOSURE\)/);
  const ci = readFileSync(fileURLToPath(new URL('../../../../.github/workflows/ci.yml', import.meta.url)), 'utf8');
  assert.doesNotMatch(ci, /EXPO_PUBLIC_DISCLOSURE/);
});
