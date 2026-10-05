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
  const spentPrice = snapshot.grades.find((grade) => grade.grade === result.item.grade)?.price ?? 0;
  const grades = snapshot.grades.map((grade) => {
    if (grade.grade !== result.item.grade || alreadyOwned) return grade;
    const owned = grade.owned + 1;
    const remaining = grade.total - owned;
    return { ...grade, owned, remaining, probabilityPerItem: remaining > 0 ? 1 / remaining : null };
  });
  const clothingReward = result.rewards.clothing.item;
  const clothingItems = snapshot.clothing.items.map((item) => (
    clothingReward && item.id === clothingReward.id ? { ...item, owned: true } : item
  ));
  const firstApply = !result.replayed && !alreadyOwned;
  return {
    ...state,
    snapshot: {
      ...snapshot,
      items,
      grades,
      clothing: { ...snapshot.clothing, items: clothingItems },
      mileage: {
        ...snapshot.mileage,
        earned: firstApply ? snapshot.mileage.earned + result.rewards.mileage.amount : snapshot.mileage.earned,
        spent: firstApply ? snapshot.mileage.spent + spentPrice : snapshot.mileage.spent,
        balance: result.balance,
      },
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
  // PR #312 리뷰: dispose() 뒤(세션 만료로 화면이 다시 마운트되는 동안 등) 뒤늦게 끝난 호출이 사라진 화면에 setState하지
  // 않도록 막는다.
  let disposed = false;

  async function load(quiet: boolean): Promise<boolean> {
    const request = gate.begin();
    try {
      const next = await api.getShop();
      // cross-review 2번: 그 사이 구매·대표 설정이 확정되어(applyReroll/applyAvatar) 이 조회가 낡은 것이 됐으면
      // 아무것도 반영하지 않은 것이니 성공으로 보고하면 안 된다 — 호출자(buy()의 SHOP_STATE_CHANGED 처리)가
      // "새로고침됨"으로 믿고 낡은 확률 위에 "업데이트됨" 안내를 보여주는 결함으로 이어졌다.
      if (!gate.isLatest(request)) return false;
      apply(() => loaded(next));
      return true;
    } catch (caught) {
      if (gate.isLatest(request)) apply((state) => failed(state, caught, quiet));
      return false;
    }
  }

  return {
    load,
    applyReroll(result: ShopRerollResult): void {
      if (disposed) return;
      // 구매·대표 설정이 확정한 상태를, 그 전에 시작해 아직 끝나지 않은 GET /shop 응답이 뒤늦게 덮어쓰지 않도록
      // 지금 진행 중인 조회를 낡은 것으로 만든다(friends-loader.ts의 changeMe와 같은 모양, PR #312 리뷰).
      gate.invalidate();
      apply((state) => withReroll(state, result));
    },
    applyAvatar(avatar: string | null): void {
      if (disposed) return;
      gate.invalidate();
      apply((state) => withAvatar(state, avatar));
    },
    dispose(): void {
      disposed = true;
      gate.invalidate();
    },
  };
}
