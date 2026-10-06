import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('owner greetings and UI sounds preserve the same foreground audio session policy', () => {
  for (const path of ['./sound/ui-sounds.ts', './screens/collection/collectible-detail.tsx']) {
    const code = source(path);
    assert.match(code, /setAudioModeAsync\(foregroundAudioMode\)/);
    assert.doesNotMatch(code, /setAudioModeAsync\(\{/);
  }
  const mode = source('./sound/playback-audio-mode.ts');
  assert.match(mode, /playsInSilentMode: false/);
  assert.match(mode, /interruptionMode: 'mixWithOthers'/);
});

test('shared controls play tap only from enabled press handlers and tab navigation respects prevention', () => {
  for (const path of ['./ui/bounce-button.tsx', './ui/floating-card.tsx']) {
    assert.match(source(path), /onPress=\{\(\) => \{ void lightHaptic\(\); playUiSound\('tap'\); onPress\(\); \}\}/);
  }
  const tabs = source('./navigation/floating-tab-bar.tsx');
  assert.match(tabs, /if \(!selected && !event\.defaultPrevented\) \{\s*playUiSound\('navigate'\);\s*navigation\.navigate/);
  assert.doesNotMatch(tabs, /playUiSound\('navigate'\)[\s\S]*const event = navigation\.emit/);
});

test('account setting is accessible, waits for persisted state, and describes its device scope', () => {
  const layout = source('./app/_layout.tsx');
  const settings = source('./screens/account-settings/index.tsx');
  const volume = source('./screens/account-settings/settings-volume.tsx');
  assert.match(layout, /useEffect\(\(\) => initializeUiSounds\(\), \[\]\)/);
  assert.match(settings, /<SettingsVolume settings=\{soundSettings\} styles=\{styles\} palette=\{palette\} \/>/);
  assert.match(volume, /accessibilityLabel="효과음"/);
  assert.match(volume, /disabled=\{!settings\.ready\}/);
  assert.match(volume, /onValueChange=\{settings\.setEnabled\}/);
  assert.match(volume, /버튼·화면 이동·보상 획득 효과음\. 이 기기에 저장돼요\./);
  assert.match(volume, /accessibilityLabel="배경음악"/);
  assert.match(volume, /label: '뽑기만'/);
  assert.match(volume, /소리·진동 초기화/);
  assert.match(settings, /soundSettings\.persistenceError/);
});

test('draw music and draw haptics are owned by the gacha modal without changing root initialization', () => {
  const sounds = source('./sound/ui-sounds.ts');
  const gacha = source('./screens/shop/gacha-machine.tsx');
  const effects = source('./gamification/native-effects.ts');
  assert.match(sounds, /export function useDrawMusic\(enabled = true\)/);
  assert.match(sounds, /controller\.setDrawMusicFocused\(true\)/);
  assert.match(sounds, /controller\.setDrawMusicFocused\(false\)/);
  assert.match(gacha, /import \{ playUiSound, useDrawMusic \} from '@\/sound\/ui-sounds'/);
  assert.match(gacha, /useDrawMusic\(\)/);
  assert.match(gacha, /void drawHaptic\(\); playUiSound\('open'\)/);
  assert.match(effects, /export async function drawHaptic\(\)/);
  assert.match(effects, /mode !== 'DRAW_ONLY' && mode !== 'ALL'/);
});

test('claim and reward success sounds require fresh server results', () => {
  const claim = source('./screens/claim-redeem/index.tsx');
  const redeem = claim.slice(claim.indexOf('async function redeem()'), claim.indexOf('async function findGrantedArtwork'));
  assert.match(redeem, /await api\.redeemClaim\(target\);\s*if \(!redeemGate\.isCurrent\(request\)\) return;\s*(?:if \(securePending\) void pendingStore\.clearIfMatches\(accountId, pending\)\.catch\(\(\) => undefined\);\s*)?if \(!result\.replayed\) playUiSound\('success'\)/);
  assert.match(redeem, /catch \(error\) \{\s*if \(!redeemGate\.isCurrent\(request\)\) return;\s*playUiSound\('error'\)/);
  assert.doesNotMatch(claim.slice(claim.indexOf('function handleScanned'), claim.indexOf('async function inspect')), /playUiSound\('error'\)/);

  const box = source('./gamification/reward-box.tsx');
  assert.match(box, /catch \(caught\) \{\s*if \(!isCurrent\(\)\) return;\s*box\.current\?\.settle\(\);[\s\S]*?playUiSound\('error'\);\s*const code/);

  const reveal = source('./gamification/reward-reveal.tsx');
  assert.match(reveal, /!result\.replayed && celebratedCoupon\.current !== result\.coupon\.couponId/);
  assert.match(reveal, /celebratedCoupon\.current = result\.coupon\.couponId;\s*void successHaptic\(\);\s*playUiSound\('success'\)/);
});

test('envelope cues follow opening, foreground completion, and actual card changes', () => {
  const envelope = source('./screens/collection/envelope/envelope-reveal.tsx');
  const open = envelope.slice(envelope.indexOf('function openEnvelope'), envelope.indexOf('function goTo'));
  const step = envelope.slice(envelope.indexOf('function goTo'), envelope.indexOf('const panResponder'));
  assert.match(open, /setUiStage\('tearing'\);\s*playUiSound\('open'\)/);
  assert.match(open, /onStageComplete:[\s\S]*AppState\.currentState === 'active'\) playUiSound\('success'\)/);
  assert.match(step, /return current\.stage === 'end' \? \(next\.stage === 'end' \? current : next\)/);
  assert.match(envelope, /previous\.stage !== cardStep\.stage \|\| \(previous\.stage === 'cards' && cardStep\.stage === 'cards' && previous\.index !== cardStep\.index\)/);
  assert.match(envelope, /playUiSound\('flip'\)/);
  assert.doesNotMatch(step, /playUiSound/);
});
