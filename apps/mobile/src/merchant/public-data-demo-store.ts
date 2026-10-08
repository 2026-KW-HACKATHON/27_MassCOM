export const PUBLIC_DATA_DEMO_STORE_LABEL = '실제 가게 정보로 만든 시연 · 참여하지 않은 가게';

export function isPublicDataDemoStore(merchantId: string | undefined): boolean {
  return merchantId?.startsWith('showcase-wolgye-') ?? false;
}

/** Display text only; keep the API's name intact for searching, sharing and navigation. */
export function publicDataDemoStoreName(merchantId: string | undefined, name: string): string {
  return isPublicDataDemoStore(merchantId) ? `${name} · ${PUBLIC_DATA_DEMO_STORE_LABEL}` : name;
}
