import type { ImageExportOutcome } from '@/gamification/native-effects';

export type CollectionShareOutcome = ImageExportOutcome | 'failed' | 'stopped';

export type CollectionShareDeps = {
  nextFrame: () => Promise<void>;
  imagesReady: () => Promise<void>;
  settle: () => Promise<void>;
  captureViewAsPng: () => Promise<string | undefined>;
  exportImageFile: (uri: string, isAlive: () => boolean) => Promise<ImageExportOutcome>;
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
    const outcome = await deps.exportImageFile(uri, deps.isAlive);
    return deps.isAlive() ? outcome : 'stopped';
  } catch {
    return deps.isAlive() ? 'failed' : 'stopped';
  }
}

export function collectionShareNotice(outcome: CollectionShareOutcome): string | undefined {
  if (outcome === 'shared') return '공유 창을 열었어요.';
  if (outcome === 'saved') return '도감 이미지를 저장했어요.';
  if (outcome === 'cancelled') return '공유를 취소했어요.';
  if (outcome === 'unavailable') return '이 기기에서는 도감 이미지를 내보낼 수 없어요.';
  if (outcome === 'failed') return '도감 카드를 만들지 못했어요. 다시 시도해 주세요.';
  return undefined;
}

export function createImageLoadGate(expected: number) {
  const seen = new Set<string>();
  const waiters: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  let failure: Error | undefined;
  const release = (error?: Error) => {
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      if (error) waiter.reject(error); else waiter.resolve();
    }
  };
  return {
    markLoaded(key: string) {
      if (failure || seen.has(key)) return;
      seen.add(key);
      if (seen.size >= expected) release();
    },
    markFailed(key: string) {
      if (failure || seen.has(key)) return;
      failure = new Error('IMAGE_LOAD_FAILED');
      release(failure);
    },
    wait(timeoutMs: number): Promise<void> {
      if (failure) return Promise.reject(failure);
      if (seen.size >= expected) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const waiter = { resolve, reject, timer: setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('IMAGE_LOAD_TIMEOUT'));
        }, timeoutMs) };
        waiters.push(waiter);
      });
    },
  };
}
