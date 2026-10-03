export const detailViewSources = ['list', 'map', 'recommendation', 'collection', 'friend', 'link', 'other'] as const;
export type DetailViewSource = typeof detailViewSources[number];

export function detailViewSource(value: string | undefined): DetailViewSource {
  return detailViewSources.find((source) => source === value) ?? 'link';
}

const sent = new Set<string>();

/** 한 앱 세션의 KST 날짜·가게마다 요청을 한 번만 보낸다. 계정·기기 식별자는 전송하지 않는다. */
export async function sendMerchantDetailView(
  apiUrl: string,
  merchantId: string,
  source: DetailViewSource,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<void> {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const key = `${day}:${merchantId}`;
  if (sent.has(key)) return;
  sent.add(key);
  await fetcher(`${apiUrl}/merchants/${encodeURIComponent(merchantId)}/views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  });
}
