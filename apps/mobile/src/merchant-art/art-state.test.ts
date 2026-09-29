import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  artPanel,
  artReducer,
  canFinalize,
  canStartDrafts,
  draftAccessibilityLabel,
  initialArtState,
  isNewerRound,
  isRoundInProgress,
  pollTarget,
  quotaSummary,
  type ArtScreenState,
} from './art-state';
import type { ArtRound, ArtRoundStatus, OwnerArt } from './owner-art-api';

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const artUrl = `/merchant-art/${'ab'.repeat(32)}.webp`;
const labels = ['도장', '스티커', '수채화', '판화'];

function round(status: ArtRoundStatus, overrides: Partial<ArtRound> = {}): ArtRound {
  const drafted = status !== 'DRAFTING' && !(status === 'FAILED');
  return {
    id: idA, status, chosenIndex: status === 'FINALIZING' || status === 'FINAL_READY' ? 1 : null,
    drafts: drafted ? labels.map((label, index) => ({ index, style: `S${index}`, label, imageDataUrl: 'data:image/webp;base64,AAAA' })) : [],
    final: status === 'FINAL_READY' ? { imageDataUrl: 'data:image/webp;base64,BBBB' } : null,
    failureCode: status === 'FAILED' ? 'AI_ART_TIMEOUT' : null, createdAt: '2026-09-29T10:00:00.000Z', ...overrides,
  };
}
const art = (overrides: Partial<OwnerArt> = {}): OwnerArt => ({
  configured: true, current: null, quota: { draftRoundsLeft: 3, finalsLeft: 3 }, round: null, ...overrides,
});
const ready = (overrides: Partial<OwnerArt> = {}, extra: Partial<Extract<ArtScreenState, { status: 'ready' }>> = {}): ArtScreenState => ({
  status: 'ready', art: art(overrides), selected: null, busy: null, notice: null, ...extra,
});
const readyState = (state: ArtScreenState) => {
  assert.equal(state.status, 'ready');
  return state as Extract<ArtScreenState, { status: 'ready' }>;
};

test('the screen starts loading, then shows what the server said, or says it could not load', () => {
  assert.deepEqual(initialArtState, { status: 'loading' });
  const loaded = artReducer(initialArtState, { type: 'loaded', art: art({ current: { artUrl } }) });
  assert.deepEqual(loaded, { status: 'ready', art: art({ current: { artUrl } }), selected: null, busy: null, notice: null });
  assert.deepEqual(artReducer(initialArtState, { type: 'load-failed', message: '실패' }), { status: 'error', message: '실패' });
  assert.deepEqual(artReducer({ status: 'error', message: '실패' }, { type: 'load-started' }), { status: 'loading' });
});

test('a reload that fails keeps the screen the owner sees and says so in one line', () => {
  const before = ready({ round: round('DRAFTS_READY') });
  const after = readyState(artReducer(before, { type: 'load-failed', message: '네트워크' }));
  assert.equal(after.notice, '네트워크');
  assert.equal(after.art.round?.status, 'DRAFTS_READY');
  assert.equal(artReducer(before, { type: 'load-started' }), before);
});

test('actions on a screen that has not loaded do nothing', () => {
  for (const state of [initialArtState, { status: 'error', message: 'x' } as const]) {
    for (const action of [
      { type: 'select', index: 0 }, { type: 'busy', busy: 'start' }, { type: 'failed', message: 'x' }, { type: 'reset-done' },
      { type: 'round-polled', round: round('DRAFTS_READY') }, { type: 'applied', artUrl }, { type: 'dismiss-notice' },
    ] as const) {
      assert.equal(artReducer(state, action), state);
    }
  }
});

test('which panel shows follows the round: idle, drawing, pick one, redrawing, final, failed', () => {
  assert.equal(artPanel(art()), 'idle');
  assert.equal(artPanel(art({ round: round('APPLIED') })), 'idle');
  assert.equal(artPanel(art({ round: round('DRAFTING') })), 'drafting');
  assert.equal(artPanel(art({ round: round('DRAFTS_READY') })), 'drafts');
  assert.equal(artPanel(art({ round: round('FINALIZING') })), 'finalizing');
  assert.equal(artPanel(art({ round: round('FINAL_READY') })), 'final');
  assert.equal(artPanel(art({ round: round('FAILED') })), 'failed');
  assert.equal(artPanel(art({ configured: false })), 'unavailable');
  assert.equal(artPanel(art({ configured: false, round: round('DRAFTS_READY') })), 'unavailable');
});

test('polling runs only while the server is drawing and the screen is in front', () => {
  const inProgress: ArtRoundStatus[] = ['DRAFTING', 'FINALIZING'];
  const rest: ArtRoundStatus[] = ['DRAFTS_READY', 'FINAL_READY', 'APPLIED', 'FAILED'];
  for (const status of inProgress) {
    assert.equal(isRoundInProgress(status), true);
    assert.equal(pollTarget(ready({ round: round(status) }), true), idA, status);
    assert.equal(pollTarget(ready({ round: round(status) }), false), null, `${status} out of focus`);
  }
  for (const status of rest) {
    assert.equal(isRoundInProgress(status), false);
    assert.equal(pollTarget(ready({ round: round(status) }), true), null, status);
  }
  assert.equal(pollTarget(ready(), true), null);
  assert.equal(pollTarget(initialArtState, true), null);
  assert.equal(pollTarget({ status: 'error', message: 'x' }, true), null);
});

test('drafts can be started only when configured, with a try left and nothing drawing; a final needs a try left', () => {
  assert.equal(canStartDrafts(art()), true);
  assert.equal(canStartDrafts(art({ round: round('DRAFTS_READY') })), true);
  assert.equal(canStartDrafts(art({ round: round('FAILED') })), true);
  assert.equal(canStartDrafts(art({ round: round('DRAFTING') })), false);
  assert.equal(canStartDrafts(art({ round: round('FINALIZING') })), false);
  assert.equal(canStartDrafts(art({ configured: false })), false);
  assert.equal(canStartDrafts(art({ quota: { draftRoundsLeft: 0, finalsLeft: 3 } })), false);
  assert.equal(canFinalize(art()), true);
  assert.equal(canFinalize(art({ quota: { draftRoundsLeft: 3, finalsLeft: 0 } })), false);
  assert.equal(canFinalize(art({ configured: false })), false);
});

test('the counts line and the draft label read as words', () => {
  assert.equal(quotaSummary({ draftRoundsLeft: 2, finalsLeft: 0 }), '오늘 남은 횟수 · 시안 받기 2번 · 고급 그림 만들기 0번');
  assert.equal(draftAccessibilityLabel({ index: 0, label: '도장' }), 'AI 시안 1, 도장 스타일');
  assert.equal(draftAccessibilityLabel({ index: 3, label: '판화' }), 'AI 시안 4, 판화 스타일');
});

test('a pick is made among the four drafts, only when they are waiting for one and nothing is busy', () => {
  const waiting = ready({ round: round('DRAFTS_READY') });
  assert.equal(readyState(artReducer(waiting, { type: 'select', index: 2 })).selected, 2);
  assert.equal(readyState(artReducer(ready({ round: round('DRAFTS_READY') }, { selected: 2 }), { type: 'select', index: 0 })).selected, 0);
  for (const bad of [-1, 4, 1.5]) assert.equal(readyState(artReducer(waiting, { type: 'select', index: bad })).selected, null, String(bad));
  assert.equal(readyState(artReducer(ready({ round: round('DRAFTING') }), { type: 'select', index: 0 })).selected, null);
  assert.equal(readyState(artReducer(ready({ round: round('FINAL_READY') }), { type: 'select', index: 0 })).selected, null);
  assert.equal(readyState(artReducer(ready({ round: round('DRAFTS_READY') }, { busy: 'choose' }), { type: 'select', index: 0 })).selected, null);
  assert.equal(readyState(artReducer(ready({ configured: false, round: round('DRAFTS_READY') }), { type: 'select', index: 0 })).selected, null);
});

test('the pick survives polls of the same round but not a new round', () => {
  const picked = ready({ round: round('DRAFTS_READY') }, { selected: 3 });
  assert.equal(readyState(artReducer(picked, { type: 'round-polled', round: round('DRAFTS_READY') })).selected, 3);
  assert.equal(readyState(artReducer(picked, { type: 'round-polled', round: round('FINALIZING', { chosenIndex: 3 }) })).selected, null);
  const newer = round('DRAFTS_READY', { id: idB, createdAt: '2026-09-29T11:00:00.000Z' });
  assert.equal(readyState(artReducer(picked, { type: 'round-polled', round: newer })).selected, null);
});

test('a poll answer older than what is on screen is dropped: the same round never goes backwards', () => {
  const finalizing = ready({ round: round('FINALIZING') });
  assert.equal(artReducer(finalizing, { type: 'round-polled', round: round('DRAFTS_READY') }), finalizing);
  assert.equal(artReducer(finalizing, { type: 'round-polled', round: round('DRAFTING', { drafts: [] }) }), finalizing);
  const finished = ready({ round: round('FINAL_READY') });
  assert.equal(artReducer(finished, { type: 'round-polled', round: round('FINALIZING') }), finished);
  const advanced = readyState(artReducer(finalizing, { type: 'round-polled', round: round('FINAL_READY') }));
  assert.equal(advanced.art.round?.status, 'FINAL_READY');
  const failed = readyState(artReducer(finalizing, { type: 'round-polled', round: round('FAILED') }));
  assert.equal(failed.art.round?.status, 'FAILED');
});

test('a poll answer about an older round cannot replace a newer round', () => {
  const current = round('DRAFTING', { id: idB, createdAt: '2026-09-29T11:00:00.000Z' });
  const state = ready({ round: current });
  const stale = round('DRAFTS_READY', { id: idA, createdAt: '2026-09-29T10:00:00.000Z' });
  assert.equal(artReducer(state, { type: 'round-polled', round: stale }), state);
  assert.equal(isNewerRound(current, stale), false);
  assert.equal(isNewerRound(stale, current), true);
  assert.equal(isNewerRound(null, stale), true);
  assert.equal(isNewerRound(round('DRAFTS_READY'), round('DRAFTS_READY')), true);
});

test('a good poll answer clears the "could not check" line', () => {
  const noisy = ready({ round: round('DRAFTING') }, { notice: '네트워크' });
  const next = readyState(artReducer(noisy, { type: 'round-polled', round: round('DRAFTING') }));
  assert.equal(next.notice, null);
  assert.equal(readyState(artReducer(noisy, { type: 'poll-failed', message: '또 실패' })).notice, '또 실패');
  assert.equal(readyState(artReducer(noisy, { type: 'dismiss-notice' })).notice, null);
});

test('starting drafts marks busy, and the server round replaces the screen and clears the pick', () => {
  const idle = ready({}, { notice: '지난 오류' });
  const busy = readyState(artReducer(idle, { type: 'busy', busy: 'start' }));
  assert.equal(busy.busy, 'start');
  assert.equal(busy.notice, null);
  const started = readyState(artReducer(busy, { type: 'round-started', round: round('DRAFTING', { id: idB, createdAt: '2026-09-29T12:00:00.000Z' }) }));
  assert.equal(started.busy, null);
  assert.equal(started.selected, null);
  assert.equal(artPanel(started.art), 'drafting');
  assert.equal(pollTarget(started, true), idB);
});

test('choosing a draft turns the same round into the redrawing step', () => {
  const picked = ready({ round: round('DRAFTS_READY') }, { selected: 1, busy: 'choose' });
  const next = readyState(artReducer(picked, { type: 'round-started', round: round('FINALIZING', { chosenIndex: 1 }) }));
  assert.equal(artPanel(next.art), 'finalizing');
  assert.equal(next.selected, null);
  assert.equal(next.busy, null);
  assert.equal(pollTarget(next, true), idA);
});

test('a failed action stops being busy and says why', () => {
  const failed = readyState(artReducer(ready({}, { busy: 'apply' }), { type: 'failed', message: '한도' }));
  assert.equal(failed.busy, null);
  assert.equal(failed.notice, '한도');
});

test('applying makes the final picture current and closes the round; resetting takes the current picture away', () => {
  const finalReady = ready({ round: round('FINAL_READY') }, { busy: 'apply' });
  const applied = readyState(artReducer(finalReady, { type: 'applied', artUrl }));
  assert.deepEqual(applied.art.current, { artUrl });
  assert.equal(applied.art.round, null);
  assert.equal(applied.busy, null);
  assert.equal(artPanel(applied.art), 'idle');
  const reset = readyState(artReducer(ready({ current: { artUrl }, round: round('FAILED') }, { busy: 'reset' }), { type: 'reset-done' }));
  assert.equal(reset.art.current, null);
  assert.equal(reset.busy, null);
  assert.equal(reset.art.round?.status, 'FAILED');
});

test('a background refresh updates counts and current art but never sends the round backwards', () => {
  const local = ready({ round: round('FINALIZING') }, { busy: null });
  const refreshed = readyState(artReducer(local, {
    type: 'refreshed',
    art: art({ current: { artUrl }, quota: { draftRoundsLeft: 1, finalsLeft: 2 }, round: round('DRAFTS_READY') }),
  }));
  assert.deepEqual(refreshed.art.quota, { draftRoundsLeft: 1, finalsLeft: 2 });
  assert.deepEqual(refreshed.art.current, { artUrl });
  assert.equal(refreshed.art.round?.status, 'FINALIZING');
});

test('a background refresh adopts a round that moved on, keeps the round when the server sent none, and follows "not configured"', () => {
  const local = ready({ round: round('DRAFTING', { drafts: [] }) }, { selected: null });
  const moved = readyState(artReducer(local, { type: 'refreshed', art: art({ round: round('DRAFTS_READY') }) }));
  assert.equal(moved.art.round?.status, 'DRAFTS_READY');
  const none = readyState(artReducer(local, { type: 'refreshed', art: art({ round: null }) }));
  assert.equal(none.art.round?.status, 'DRAFTING');
  const off = readyState(artReducer(local, { type: 'refreshed', art: art({ configured: false }) }));
  assert.equal(off.art.configured, false);
});

test('a refresh keeps the pick while the same round still waits for one', () => {
  const local = ready({ round: round('DRAFTS_READY') }, { selected: 2 });
  assert.equal(readyState(artReducer(local, { type: 'refreshed', art: art({ round: round('DRAFTS_READY') }) })).selected, 2);
  assert.equal(readyState(artReducer(local, { type: 'refreshed', art: art({ round: round('FINALIZING', { chosenIndex: 2 }) }) })).selected, null);
});

test('a full reload replaces everything, including a round the screen had wrong', () => {
  const local = ready({ round: round('DRAFTS_READY') }, { selected: 1, busy: 'choose', notice: '오류' });
  const reloaded = artReducer(local, { type: 'loaded', art: art({ round: round('FINAL_READY', { chosenIndex: 0 }) }) });
  assert.deepEqual(reloaded, { status: 'ready', art: art({ round: round('FINAL_READY', { chosenIndex: 0 }) }), selected: null, busy: null, notice: null });
});
