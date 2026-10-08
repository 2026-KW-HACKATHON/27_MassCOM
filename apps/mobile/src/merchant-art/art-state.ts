import { DRAFT_COUNT, type ArtDraft, type ArtQuota, type ArtRound, type ArtRoundStatus, type OwnerArt } from './owner-art-api';

// 점주 그림 화면의 상태 모델. 화면은 이 reducer가 돌려주는 상태만 그리고, 서버 응답의 새로움 판단과 어느 패널을 보일지도 여기서 정한다.

export type ArtBusy = 'start' | 'choose' | 'apply' | 'upload' | 'reset';

export type ArtScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; art: OwnerArt; selected: number | null; busy: ArtBusy | null; notice: string | null };

export type ArtAction =
  | { type: 'load-started' }
  | { type: 'load-failed'; message: string }
  /** The whole picture from the server (first load, retry, or a reload after a step the server had moved past; `notice` keeps that step's line). */
  | { type: 'loaded'; art: OwnerArt; notice?: string }
  /** A background reload: counts, current art and the configured flag follow the server, the round only if it is not older. */
  | { type: 'refreshed'; art: OwnerArt }
  | { type: 'select'; index: number }
  | { type: 'busy'; busy: ArtBusy }
  /** An action failed: nothing is busy, one line says why. */
  | { type: 'failed'; message: string }
  /** The server answered "start" or "choose" with the round it now works on; an owner's own action is authoritative. */
  | { type: 'round-started'; round: ArtRound }
  | { type: 'round-polled'; round: ArtRound }
  | { type: 'poll-failed'; message: string }
  | { type: 'applied'; artUrl: string }
  | { type: 'reset-done' }
  | { type: 'dismiss-notice' };

export type ArtPanel = 'unavailable' | 'idle' | 'drafting' | 'drafts' | 'finalizing' | 'final' | 'failed';

export const initialArtState: ArtScreenState = { status: 'loading' };

// A round only moves forward. FAILED and APPLIED are where it ends.
const roundRank: Record<ArtRoundStatus, number> = { DRAFTING: 0, DRAFTS_READY: 1, FINALIZING: 2, FINAL_READY: 3, APPLIED: 4, FAILED: 4 };

export function isRoundInProgress(status: ArtRoundStatus): boolean {
  return status === 'DRAFTING' || status === 'FINALIZING';
}

/**
 * Whether a round read from the server may replace the one on screen. Answers can arrive out of order (a poll that started before
 * the owner tapped, a reload that overtook one), so an older picture of the same round, or of an older round, is dropped.
 */
export function isNewerRound(current: ArtRound | null, incoming: ArtRound): boolean {
  if (current === null) return true;
  if (current.id === incoming.id) return roundRank[incoming.status] >= roundRank[current.status];
  return Date.parse(incoming.createdAt) >= Date.parse(current.createdAt);
}

export function artPanel(art: OwnerArt): ArtPanel {
  if (!art.configured) return 'unavailable';
  switch (art.round?.status) {
    case 'DRAFTING': return 'drafting';
    case 'DRAFTS_READY': return 'drafts';
    case 'FINALIZING': return 'finalizing';
    case 'FINAL_READY': return 'final';
    case 'FAILED': return 'failed';
    default: return 'idle';
  }
}

/** The round id to poll, or null: only while the server is drawing (DRAFTING or FINALIZING) and the screen is in front. */
export function pollTarget(state: ArtScreenState, focused: boolean): string | null {
  if (!focused || state.status !== 'ready') return null;
  const round = state.art.round;
  return round && isRoundInProgress(round.status) ? round.id : null;
}

export function canStartDrafts(art: OwnerArt, now = Date.now()): boolean {
  const account = art.quota.account;
  return art.configured && art.quota.draftRoundsLeft > 0
    && (!account || (account.draftRoundsLeft > 0 && (!account.cooldownUntil || Date.parse(account.cooldownUntil) <= now)))
    && !(art.round && isRoundInProgress(art.round.status));
}

/**
 * A round the owner can pick a draft from: one waiting for the pick, or one whose final failed while its four drafts are still
 * there (the server lets the same round choose again; it counts as a new final). A round that failed while drawing the drafts
 * has none to pick and needs a new round.
 */
export function canPickDraft(round: ArtRound | null): boolean {
  if (round === null) return false;
  return round.status === 'DRAFTS_READY'
    || (round.status === 'FAILED' && round.chosenIndex !== null && round.drafts.length === DRAFT_COUNT);
}

export function canFinalize(art: OwnerArt, now = Date.now()): boolean {
  const account = art.quota.account;
  return art.configured && art.quota.finalsLeft > 0
    && (!account || (account.finalsLeft > 0 && (!account.cooldownUntil || Date.parse(account.cooldownUntil) <= now)));
}

export function quotaSummary(quota: ArtQuota, now = Date.now()): string {
  const store = `이 가게 오늘 남은 횟수 · 시안 받기 ${quota.draftRoundsLeft}번 · 고급 그림 만들기 ${quota.finalsLeft}번`;
  if (!quota.account) return store;
  const account = quota.account;
  const wait = account.cooldownUntil ? Math.ceil((Date.parse(account.cooldownUntil) - now) / 1000) : 0;
  return `${store}\n계정 전체 하루 시안 3회·최종 3회 · 현재 남은 시안 ${account.draftRoundsLeft}번 · 최종 ${account.finalsLeft}번`
    + (wait > 0 ? ` · 다음 생성까지 ${wait}초` : '')
    + ((account.draftRoundsLeft === 0 || account.finalsLeft === 0)
      ? `\n한국 시간 ${new Date(account.resetsAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}에 계정 횟수가 초기화돼요.` : '');
}

/** What a screen reader says for a draft: its number and style; whether it is picked is the button's selected state. */
export function draftAccessibilityLabel(draft: Pick<ArtDraft, 'index' | 'label'>): string {
  return `AI 시안 ${draft.index + 1}, ${draft.label} 스타일`;
}

export function artReducer(state: ArtScreenState, action: ArtAction): ArtScreenState {
  switch (action.type) {
    case 'load-started':
      return state.status === 'ready' ? state : { status: 'loading' };
    case 'load-failed':
      // A reload that fails keeps the screen the owner is looking at; only a screen that never loaded says it could not.
      return state.status === 'ready' ? { ...state, notice: action.message } : { status: 'error', message: action.message };
    case 'loaded':
      return { status: 'ready', art: action.art, selected: null, busy: null, notice: action.notice ?? null };
    default:
      break;
  }
  // Everything below changes a screen that has loaded.
  if (state.status !== 'ready') return state;
  switch (action.type) {
    case 'refreshed': {
      const incoming = action.art.round;
      const round = incoming && isNewerRound(state.art.round, incoming) ? incoming : state.art.round;
      return withRound({ ...state, art: { ...action.art, round } }, state.art.round, round);
    }
    case 'select': {
      const round = state.art.round;
      const known = round?.drafts.some((draft) => draft.index === action.index) ?? false;
      return state.art.configured && canPickDraft(round) && state.busy === null && known ? { ...state, selected: action.index } : state;
    }
    case 'busy':
      return { ...state, busy: action.busy, notice: null };
    case 'failed':
      return { ...state, busy: null, notice: action.message };
    case 'round-started':
      return { ...state, art: { ...state.art, round: action.round }, selected: null, busy: null, notice: null };
    case 'round-polled': {
      if (!isNewerRound(state.art.round, action.round)) return state;
      return withRound({ ...state, notice: null }, state.art.round, action.round);
    }
    case 'poll-failed':
      return { ...state, notice: action.message };
    case 'applied':
      return { ...state, art: { ...state.art, current: { artUrl: action.artUrl }, round: null }, selected: null, busy: null, notice: null };
    case 'reset-done':
      return { ...state, art: { ...state.art, current: null }, busy: null, notice: null };
    case 'dismiss-notice':
      return { ...state, notice: null };
    default:
      return state;
  }
}

/** Puts `next` on screen; the owner's pick survives only while the very same round is still waiting for a pick (or for a redo). */
function withRound(
  state: Extract<ArtScreenState, { status: 'ready' }>,
  previous: ArtRound | null,
  next: ArtRound | null,
): ArtScreenState {
  const keepPick = previous !== null && next !== null && previous.id === next.id && canPickDraft(previous) && canPickDraft(next);
  return { ...state, art: { ...state.art, round: next }, selected: keepPick ? state.selected : null };
}
