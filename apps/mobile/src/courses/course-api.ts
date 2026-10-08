import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';
import { parseCollectibleArtwork, type CollectibleArtwork } from '@/commerce/collectible-artwork';

export type CourseSituation = 'AFTER_MEAL' | 'TAKEOUT' | 'OTHER';
export type CourseStep = {
  position: number; merchantId: string; merchantName: string; targetVisitCount: 1 | 3 | 5;
  pieceKey: string; pieceLabel: string; done: boolean; earnedAt: string | null;
  progressVisitCount: number | null; full: boolean; artwork?: CollectibleArtwork;
};
export type Course = {
  id: string; title: string; situation: CourseSituation; situationLabel: string; sceneKey: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED'; startsAt: string | null; endsAt: string | null;
  done: number; total: number; state: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'UNLOCKED' | 'STALE';
  stale: boolean; unlockedAt: string | null; steps: CourseStep[];
};

type Options = { apiUrl: string; credential: AccountCredential; onSessionInvalid?: () => void | Promise<void>; fetcher?: typeof fetch };
export class CourseApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = 'CourseApiError'; }
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const dateOrNull = (value: unknown): value is string | null => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
const int = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
function invalid(): never { throw new CourseApiError(200, 'INVALID_RESPONSE'); }

export function parseCourse(value: unknown): Course {
  if (!record(value) || !str(value.id) || !str(value.title) || !str(value.situationLabel) || !str(value.sceneKey) ||
    !['AFTER_MEAL', 'TAKEOUT', 'OTHER'].includes(String(value.situation)) ||
    !['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'].includes(String(value.status)) ||
    !['NOT_STARTED', 'IN_PROGRESS', 'READY', 'UNLOCKED', 'STALE'].includes(String(value.state)) ||
    !dateOrNull(value.startsAt) || !dateOrNull(value.endsAt) || !dateOrNull(value.unlockedAt) ||
    !int(value.done) || !int(value.total) || value.total < 2 || value.total > 4 || value.done > value.total ||
    typeof value.stale !== 'boolean' || !Array.isArray(value.steps) || value.steps.length !== value.total) invalid();
  const steps = value.steps.map((item: unknown): CourseStep => {
    if (!record(item) || !int(item.position) || item.position < 1 || item.position > 4 ||
      !str(item.merchantId) || !str(item.merchantName) ||
      (item.targetVisitCount !== 1 && item.targetVisitCount !== 3 && item.targetVisitCount !== 5) ||
      !str(item.pieceKey) || !str(item.pieceLabel) || typeof item.done !== 'boolean' ||
      !dateOrNull(item.earnedAt) || (item.progressVisitCount !== null && !int(item.progressVisitCount)) ||
      typeof item.full !== 'boolean') invalid();
    const artwork = item.artwork === undefined ? undefined : parseCollectibleArtwork(item.artwork);
    if (item.artwork !== undefined && !artwork) invalid();
    return { position: item.position, merchantId: item.merchantId, merchantName: item.merchantName,
      targetVisitCount: item.targetVisitCount, pieceKey: item.pieceKey, pieceLabel: item.pieceLabel,
      done: item.done, earnedAt: item.earnedAt, progressVisitCount: item.progressVisitCount,
      full: item.full, ...(artwork ? { artwork } : {}) };
  });
  if (new Set(steps.map(step => step.position)).size !== steps.length ||
    steps.filter(step => step.done).length !== value.done || value.stale !== (value.state === 'STALE')) invalid();
  return { id: value.id, title: value.title, situation: value.situation as CourseSituation,
    situationLabel: value.situationLabel, sceneKey: value.sceneKey, status: value.status as Course['status'],
    startsAt: value.startsAt, endsAt: value.endsAt, done: value.done, total: value.total,
    state: value.state as Course['state'], stale: value.stale, unlockedAt: value.unlockedAt, steps };
}

export function createCourseApiClient(options: Options) {
  const base = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;
  async function request(path: string, method: 'GET' | 'POST' = 'GET', signal?: AbortSignal): Promise<unknown> {
    const headers = new Headers({ Accept: 'application/json' });
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) headers.set(name, value);
    if (method === 'POST') headers.set('Content-Type', 'application/json');
    const response = await fetcher(`${base}/me/courses${path}`, {
      method, headers, signal, ...(method === 'POST' ? { body: '{}' } : {}),
    });
    const payload = await response.json();
    if (!response.ok) {
      const code = record(payload) && str(payload.code) ? payload.code : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) await options.onSessionInvalid?.();
      throw new CourseApiError(response.status, code);
    }
    return payload;
  }
  return {
    async list(signal?: AbortSignal): Promise<Course[]> {
      const value = await request('', 'GET', signal);
      if (!record(value) || !Array.isArray(value.courses)) invalid();
      return value.courses.map(parseCourse);
    },
    async get(id: string, signal?: AbortSignal): Promise<Course> {
      const value = await request(`/${encodeURIComponent(id)}`, 'GET', signal);
      if (!record(value)) invalid();
      return parseCourse(value.course);
    },
    async unlock(id: string): Promise<{ course: Course; replayed: boolean }> {
      const value = await request(`/${encodeURIComponent(id)}/unlock`, 'POST');
      if (!record(value) || typeof value.replayed !== 'boolean') invalid();
      return { course: parseCourse(value.course), replayed: value.replayed };
    },
  };
}
