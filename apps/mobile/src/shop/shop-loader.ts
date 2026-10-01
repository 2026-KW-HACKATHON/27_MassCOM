import { createLatestGate } from '@/friends/friends-loader';

import type { ShopApiClient, ShopRerollResult, ShopSnapshot } from './shop-api';

// useShop 뒤의 요청 관리. friends-loader.ts와 같은 모양(최신 요청만 반영)이라 createLatestGate를 그대로 가져와 쓴다.

export type ShopStatus = 'loading' | 'ready' | 'error';
export type ShopLoad = { snapshot?: ShopSnapshot; status: ShopStatus; error?: unknown };

export const initialShopLoad: ShopLoad = { status: 'loading' };

export function loaded(snapshot: ShopSnapshot): ShopLoad {
  return { snapshot, status: 'ready', error: undefined };
}

/** 조용한 새로고침 실패는 화면에 보이던 것을 그대로 둔다(ready는 ready로); 첫 로드나 재시도 실패는 error다. */
export function failed(state: ShopLoad, error: unknown, quiet: boolean): ShopLoad {
  return { ...state, error, status: quiet && state.status === 'ready' ? 'ready' : 'error' };
}

/**
 * 서버가 확정한 재뽑기 결과를 전체 새로고침 전에 바로 반영한다: 그 친구를 보유로, 등급 남은 수를 줄이고, 잔액을 서버가
 * 돌려준 값으로 맞춘다. requestId가 재생(replay)됐어도 값은 서버가 준 그대로라 다시 적용해도 안전하다.
 */
export function withReroll(state: ShopLoad, result: ShopRerollResult): ShopLoad {
  if (!state.snapshot) return state;
  const snapshot = state.snapshot;
  const items = snapshot.items.map((item) => (item.id === result.item.id ? { ...item, owned: true } : item));
  const alreadyOwned = snapshot.items.find((item) => item.id === result.item.id)?.owned ?? false;
  const grades = snapshot.grades.map((grade) => {
    if (grade.grade !== result.item.grade || alreadyOwned) return grade;
    const owned = grade.owned + 1;
    const remaining = grade.total - owned;
    return { ...grade, owned, remaining, probabilityPerItem: remaining > 0 ? 1 / remaining : null };
  });
  return {
    ...state,
    snapshot: {
      ...snapshot,
      items,
      grades,
      mileage: { ...snapshot.mileage, balance: result.balance, spent: snapshot.mileage.earned - result.balance },
    },
  };
}

export function withAvatar(state: ShopLoad, avatar: string | null): ShopLoad {
  return state.snapshot ? { ...state, snapshot: { ...state.snapshot, avatar } } : state;
}

/** 상점 한 판(me.snapshot)을 불러오고 각 변화를 apply로 알린다. 더 새로운 요청이나 teardown 뒤에 끝난 응답은 버린다. */
export function createShopLoader(
  api: Pick<ShopApiClient, 'getShop'>,
  apply: (update: (state: ShopLoad) => ShopLoad) => void,
) {
  const gate = createLatestGate();

  async function load(quiet: boolean): Promise<void> {
    const request = gate.begin();
    try {
      const next = await api.getShop();
      if (gate.isLatest(request)) apply(() => loaded(next));
    } catch (caught) {
      if (gate.isLatest(request)) apply((state) => failed(state, caught, quiet));
    }
  }

  return {
    load,
    applyReroll(result: ShopRerollResult): void {
      apply((state) => withReroll(state, result));
    },
    applyAvatar(avatar: string | null): void {
      apply((state) => withAvatar(state, avatar));
    },
    dispose(): void {
      gate.invalidate();
    },
  };
}
