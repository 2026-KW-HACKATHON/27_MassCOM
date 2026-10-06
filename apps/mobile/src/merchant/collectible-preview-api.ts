export type CollectiblePreviewGoal = {
  visitCount: number;
  gradeId: string;
  gradeName: string;
  shape: string;
  theme: string;
  thumbnailDataUrl: string | null;
};

export type CollectiblePreview = {
  merchantId: string;
  campaignId: string;
  publicationId?: string;
  name: string;
  goals: readonly CollectiblePreviewGoal[];
};

/** 공개 목록과 같은 가게에만 열리는 미리보기. 404면 공개된 수집품 연결이 없는 상태다. */
export async function fetchCollectiblePreview(
  apiUrl: string,
  merchantId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CollectiblePreview | null> {
  const response = await fetcher(`${apiUrl}/merchants/${encodeURIComponent(merchantId)}/collectible-preview`, {
    headers: { Accept: 'application/json' }, signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('수집품 미리보기를 불러오지 못했습니다.');
  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.merchantId !== merchantId ||
    typeof payload.campaignId !== 'string' || typeof payload.name !== 'string' ||
    (payload.publicationId !== undefined && (typeof payload.publicationId !== 'string' || !payload.publicationId)) ||
    !Array.isArray(payload.goals) || !payload.goals.every(isGoal)) {
    throw new Error('수집품 미리보기 응답 형식이 올바르지 않습니다.');
  }
  return payload as CollectiblePreview;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGoal(value: unknown): value is CollectiblePreviewGoal {
  return isRecord(value) && Number.isSafeInteger(value.visitCount) && (value.visitCount as number) > 0 &&
    typeof value.gradeId === 'string' && typeof value.gradeName === 'string' &&
    typeof value.shape === 'string' && typeof value.theme === 'string' &&
    // 도감과 같은 인라인 그림만 허용한다. 공개 미리보기가 임의 원격 주소를 읽지 않게 한다.
    (value.thumbnailDataUrl === null || (typeof value.thumbnailDataUrl === 'string' && value.thumbnailDataUrl.length <= 350_000 &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.thumbnailDataUrl)));
}
