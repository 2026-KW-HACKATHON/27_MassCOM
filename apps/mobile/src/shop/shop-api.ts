import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';

// 마일리지 상점(Issue #298) 계약(apps/api/README.md, docs/superpowers/scratchpad design-298.md). 서버가 정본이며, 앱은
// 등급별 가격·카탈로그를 다시 적지 않고 GET /shop 응답을 그대로 읽는다(design-298.md: "앱이 하드코딩하지 않도록").

export type MileageGrade = 'BRONZE' | 'SILVER' | 'GOLD';

export function isMileageGrade(value: unknown): value is MileageGrade {
  return value === 'BRONZE' || value === 'SILVER' || value === 'GOLD';
}

export type ShopGradeView = {
  grade: MileageGrade;
  price: number;
  total: number;
  owned: number;
  remaining: number;
  probabilityPerItem: number | null;
};

export type ShopItemView = { id: string; grade: MileageGrade; name: string; owned: boolean };

export type ShopSnapshot = {
  // showcaseBonus는 시연 서버가 balance에 따로 더해 준 체험 마일리지다(#333). 운영 응답에는 없고, 없으면 0으로 읽는다.
  mileage: { earned: number; spent: number; balance: number; showcaseBonus?: number; rules: { visit: number; newStore: number; series: number } };
  grades: readonly ShopGradeView[];
  items: readonly ShopItemView[];
  avatar: string | null;
};

export type ShopHistoryEntry = {
  id: string;
  amount: number;
  grade: MileageGrade;
  itemId: string;
  itemName: string;
  createdAt: string;
};

export type ShopHistory = {
  mileage: { earned: number; spent: number; balance: number };
  spends: readonly ShopHistoryEntry[];
  nextCursor: string | null;
};

export type ShopRerollResult = {
  item: { id: string; grade: MileageGrade; name: string };
  bonus?: { id: string; name: string; slot: 'hat' | 'bag' | 'prop' | 'pose' | 'decor' };
  balance: number;
  replayed: boolean;
};

export class ShopApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'ShopApiError';
  }
}

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid?: () => void | Promise<void>;
  fetcher?: typeof fetch;
};

export type ShopApiClient = ReturnType<typeof createShopApiClient>;

const maxRetryAfterSeconds = 24 * 60 * 60;

export function createShopApiClient(options: Options) {
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) {
      headers.set(name, value);
    }
    let response: Response;
    try {
      response = await fetcher(`${apiUrl}${path}`, { ...init, headers });
    } catch {
      throw new ShopApiError(0, 'NETWORK_ERROR');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) {
        await options.onSessionInvalid?.();
      }
      throw new ShopApiError(
        response.status,
        code,
        response.status === 429 ? parseRetryAfter(response.headers.get('retry-after')) : undefined,
      );
    }
    return payload;
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    async getShop(): Promise<ShopSnapshot> {
      return parseShopSnapshot(await request('/shop'));
    },

    async getHistory(cursor?: string): Promise<ShopHistory> {
      const path = cursor === undefined ? '/shop/history' : `/shop/history?cursor=${encodeURIComponent(cursor)}`;
      return parseShopHistory(await request(path));
    },

    async reroll(input: { grade: MileageGrade; requestId: string; expectedRemaining: number }): Promise<ShopRerollResult> {
      return parseRerollResult(
        await request('/shop/rerolls', json('POST', input)),
      );
    },

    async setAvatar(itemId: string | null): Promise<{ avatar: string | null }> {
      const payload = await request('/shop/avatar', json('PUT', { itemId }));
      if (!isRecord(payload) || (payload.avatar !== null && typeof payload.avatar !== 'string')) throw invalidResponse();
      return { avatar: payload.avatar };
    },
  };
}

function parseShopSnapshot(value: unknown): ShopSnapshot {
  if (!isRecord(value) || !Array.isArray(value.grades) || !Array.isArray(value.items)) throw invalidResponse();
  if (value.avatar !== null && typeof value.avatar !== 'string') throw invalidResponse();
  return {
    mileage: parseMileage(value.mileage),
    grades: value.grades.map(parseGradeView),
    items: value.items.map(parseItemView),
    avatar: value.avatar,
  };
}

function parseShopHistory(value: unknown): ShopHistory {
  if (!isRecord(value) || !Array.isArray(value.spends)) throw invalidResponse();
  if (value.nextCursor !== null && typeof value.nextCursor !== 'string') throw invalidResponse();
  if (!isRecord(value.mileage) || !isNonNegativeInteger(value.mileage.earned) || !isNonNegativeInteger(value.mileage.spent)
    || !isInteger(value.mileage.balance)) throw invalidResponse();
  return {
    mileage: { earned: value.mileage.earned, spent: value.mileage.spent, balance: value.mileage.balance },
    spends: value.spends.map(parseHistoryEntry),
    nextCursor: value.nextCursor,
  };
}

function parseRerollResult(value: unknown): ShopRerollResult {
  if (!isRecord(value) || !isInteger(value.balance) || typeof value.replayed !== 'boolean') throw invalidResponse();
  const bonus = value.bonus;
  if (bonus !== undefined && (!isRecord(bonus) || typeof bonus.id !== 'string' || !bonus.id ||
    typeof bonus.name !== 'string' || !bonus.name || !['hat', 'bag', 'prop', 'pose', 'decor'].includes(bonus.slot as string))) throw invalidResponse();
  return { item: parseCatalogRef(value.item), balance: value.balance, replayed: value.replayed,
    ...(bonus ? { bonus: bonus as ShopRerollResult['bonus'] } : {}) };
}

function parseMileage(value: unknown): ShopSnapshot['mileage'] {
  if (!isRecord(value) || !isNonNegativeInteger(value.earned) || !isNonNegativeInteger(value.spent) || !isInteger(value.balance)) {
    throw invalidResponse();
  }
  if (!isRecord(value.rules) || !isNonNegativeInteger(value.rules.visit) || !isNonNegativeInteger(value.rules.newStore)
    || !isNonNegativeInteger(value.rules.series)) throw invalidResponse();
  if (value.showcaseBonus !== undefined && !isNonNegativeInteger(value.showcaseBonus)) throw invalidResponse();
  return {
    earned: value.earned,
    spent: value.spent,
    balance: value.balance,
    showcaseBonus: value.showcaseBonus ?? 0,
    rules: { visit: value.rules.visit, newStore: value.rules.newStore, series: value.rules.series },
  };
}

function parseGradeView(value: unknown): ShopGradeView {
  if (!isRecord(value) || !isMileageGrade(value.grade) || !isNonNegativeInteger(value.price) || !isNonNegativeInteger(value.total)
    || !isNonNegativeInteger(value.owned) || !isNonNegativeInteger(value.remaining)) throw invalidResponse();
  if (value.probabilityPerItem !== null && typeof value.probabilityPerItem !== 'number') throw invalidResponse();
  return {
    grade: value.grade,
    price: value.price,
    total: value.total,
    owned: value.owned,
    remaining: value.remaining,
    probabilityPerItem: value.probabilityPerItem,
  };
}

function parseItemView(value: unknown): ShopItemView {
  const catalogRef = parseCatalogRef(value);
  if (!isRecord(value) || typeof value.owned !== 'boolean') throw invalidResponse();
  return { ...catalogRef, owned: value.owned };
}

function parseCatalogRef(value: unknown): { id: string; grade: MileageGrade; name: string } {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isMileageGrade(value.grade) || typeof value.name !== 'string' || !value.name) {
    throw invalidResponse();
  }
  return { id: value.id, grade: value.grade, name: value.name };
}

function parseHistoryEntry(value: unknown): ShopHistoryEntry {
  const catalogRef = parseCatalogRef(isRecord(value) ? { id: value.itemId, grade: value.grade, name: value.itemName } : value);
  if (!isRecord(value) || !isNonNegativeInteger(value.amount) || typeof value.id !== 'string' || !value.id
    || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) throw invalidResponse();
  return {
    id: value.id,
    amount: value.amount,
    grade: catalogRef.grade,
    itemId: catalogRef.id,
    itemName: catalogRef.name,
    createdAt: value.createdAt,
  };
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || !/^\d+$/.test(header.trim())) return undefined;
  return Math.min(maxRetryAfterSeconds, Math.max(1, Number(header.trim())));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): ShopApiError {
  return new ShopApiError(200, 'INVALID_RESPONSE');
}

/** Plain Korean for what a person can hit; a raw code or status never reaches the screen. */
export function shopErrorMessage(error: unknown): string {
  if (!(error instanceof ShopApiError)) return '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
  switch (error.code) {
    case 'INVALID_REQUEST':
      return '요청을 처리하지 못했어요. 상점을 다시 불러와 주세요.';
    case 'SHOP_INSUFFICIENT_MILEAGE':
      return '마일리지가 모자라요.';
    case 'SHOP_GRADE_COMPLETE':
      return '이 등급은 이미 모두 모았어요.';
    case 'SHOP_STATE_CHANGED':
      return '상품 정보가 바뀌어 다시 보여드려요. 요금은 빠지지 않았어요.';
    case 'SHOP_REQUEST_CONFLICT':
      return '이전 요청이 아직 처리 중이에요. 상점을 다시 불러와 주세요.';
    case 'SHOP_RATE_LIMITED':
      return error.retryAfterSeconds === undefined
        ? '잠시 후 다시 시도해 주세요.'
        : `잠시 후 다시 시도해 주세요 (${Math.max(1, Math.ceil(error.retryAfterSeconds / 60))}분)`;
    case 'SHOP_ITEM_NOT_OWNED':
      return '가지고 있지 않은 친구예요. 상점을 다시 불러와 주세요.';
    case 'ACCOUNT_DELETED':
      return '삭제된 계정이라 상점을 쓸 수 없어요.';
    case 'MILEAGE_SHOP_NOT_CONFIGURED':
      return '상점이 아직 준비되지 않았어요. 잠시 뒤에 다시 시도해 주세요.';
    case 'SESSION_INVALID':
      return '로그인이 만료됐어요. 다시 로그인해 주세요.';
    case 'NETWORK_ERROR':
      return '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
    case 'INVALID_RESPONSE':
      return '서버 응답을 확인하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
    default:
      return '요청을 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
  }
}
