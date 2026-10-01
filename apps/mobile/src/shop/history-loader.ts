import type { ShopHistory, ShopHistoryEntry } from './shop-api';

// "사용 내역"(history-section.tsx) 뒤의 순수 상태 전이. shop-loader.ts와 같은 모양으로 분리해 PR #312 리뷰 1·6번
// (빠른 두 번 탭 중복 로드, 구매·새로고침 뒤 첫 페이지 다시 불러오기)을 컴포넌트 없이 시험한다.

export type HistoryStatus = 'idle' | 'loading' | 'ready' | 'error';
export type HistoryLoad = { status: HistoryStatus; entries: readonly ShopHistoryEntry[]; nextCursor: string | null; error?: unknown };

export const initialHistoryLoad: HistoryLoad = { status: 'idle', entries: [], nextCursor: null };

/** 이미 불러오는 중이면(첫 페이지든 "더 보기"든) 새 요청을 시작하지 않는다 — 빠른 두 번 탭이 같은 커서를 중복 로드해
 * 행을 두 번 붙이는 것을 막는다(PR #312 리뷰 1번). */
export function canStartHistoryLoad(status: HistoryStatus): boolean {
  return status !== 'loading';
}

export function historyLoading(state: HistoryLoad): HistoryLoad {
  return { ...state, status: 'loading' };
}

/** cursor가 없으면(첫 페이지) 목록을 통째로 바꾸고, 있으면("더 보기") 뒤에 이어 붙인다. */
export function historyLoaded(state: HistoryLoad, page: ShopHistory, cursor: string | undefined): HistoryLoad {
  return {
    status: 'ready',
    entries: cursor === undefined ? page.spends : [...state.entries, ...page.spends],
    nextCursor: page.nextCursor,
  };
}

export function historyFailed(state: HistoryLoad, error: unknown): HistoryLoad {
  return { ...state, status: 'error', error };
}
