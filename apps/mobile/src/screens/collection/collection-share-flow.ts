// "인스타에 자랑하기"의 캡처→공유 순서(Issue #332). collectible-share-flow.ts와 같은 모양으로 React 밖에 둬서(.tsx는
// 이 저장소의 node:test가 불러올 수 없다) 지연 promise만으로 전부 시험한다. 다른 점은 둘: 문구 폴백 대신 한국어 안내를
// 돌려주고, 그림이 다 불러와진 뒤에 찍는다.

export type CollectionShareOutcome = 'shared' | 'unavailable' | 'failed' | 'stopped';

export type CollectionShareDeps = {
  nextFrame: () => Promise<void>;
  /** 카드 안의 그림이 다 불러와질 때까지(또는 제한 시간까지) 기다린다. */
  imagesReady: () => Promise<void>;
  settle: () => Promise<void>;
  /** 오프스크린 카드가 아직 그려지지 않았으면 undefined. */
  captureViewAsPng: () => Promise<string | undefined>;
  shareImageFile: (uri: string, isAlive: () => boolean) => Promise<boolean>;
  /** 캡처 전, 공유 시트를 열기 전에 다시 확인한다. 화면이 사라졌으면 낡은 도감으로 시트를 열지 않는다. */
  isAlive: () => boolean;
};

export async function performCollectionShare(deps: CollectionShareDeps): Promise<CollectionShareOutcome> {
  try {
    await deps.nextFrame();
    await deps.imagesReady();
    await deps.settle();
    if (!deps.isAlive()) return 'stopped';
    const uri = await deps.captureViewAsPng();
    if (!deps.isAlive()) return 'stopped';
    if (!uri) return 'failed';
    if (await deps.shareImageFile(uri, deps.isAlive)) return 'shared';
    // shareImageFile은 화면이 사라졌을 때도 false를 돌려준다: 그때는 "공유 불가"라고 알릴 화면이 없다.
    return deps.isAlive() ? 'unavailable' : 'stopped';
  } catch {
    return deps.isAlive() ? 'failed' : 'stopped';
  }
}

/** 사람에게 알릴 일이 있을 때만 한국어 안내를 준다. */
export function collectionShareNotice(outcome: CollectionShareOutcome): string | undefined {
  if (outcome === 'unavailable') return '이 기기에서는 이미지 공유 창을 열 수 없어요. 도감 화면을 캡처해서 직접 올려 보세요.';
  if (outcome === 'failed') return '도감 카드를 만들지 못했어요. 잠시 후 다시 시도해 주세요.';
  return undefined;
}

/**
 * 카드 안 그림 N장이 모두 불러와졌다고(성공이든 실패든) 알려 올 때까지 기다리는 문. 깨진 그림 하나가 공유를
 * 영영 붙잡지 않도록 제한 시간이 지나면 그대로 연다.
 */
export function createImageLoadGate(expected: number) {
  let remaining = Math.max(0, expected);
  const waiters: (() => void)[] = [];
  const open = () => { for (const resolve of waiters.splice(0)) resolve(); };
  return {
    markLoaded() {
      if (remaining > 0) remaining -= 1;
      if (remaining === 0) open();
    },
    wait(timeoutMs: number): Promise<void> {
      if (remaining === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    },
  };
}
