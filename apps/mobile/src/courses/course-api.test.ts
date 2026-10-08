import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCourseApiClient, CourseApiError, parseCourse } from './course-api';
import { courseChipText, courseStateText } from './course-copy';

const course = {
  id: 'course-1', title: '동네 산책', situation: 'AFTER_MEAL', situationLabel: '식사 후 들르기 좋은 곳',
  sceneKey: 'town-evening', status: 'ACTIVE', startsAt: null, endsAt: null, done: 1, total: 2,
  state: 'IN_PROGRESS', stale: false, unlockedAt: null,
  steps: [
    { position: 1, merchantId: 'store-1', merchantName: '가게 A', targetVisitCount: 1, pieceKey: 'first', pieceLabel: '첫 조각', done: true,
      earnedAt: '2026-10-08T00:00:00Z', progressVisitCount: 1, full: false },
    { position: 2, merchantId: 'store-2', merchantName: '가게 B', targetVisitCount: 3, pieceKey: 'second', pieceLabel: '둘째 조각', done: false,
      earnedAt: null, progressVisitCount: 1, full: true },
  ],
};
const options = { apiUrl: 'https://api.example.test', credential: { kind: 'bearer' as const, sessionToken: 'session' } };

test('reads authenticated course list and detail with server-computed progress', async () => {
  const paths: string[] = [];
  const api = createCourseApiClient({ ...options, fetcher: async (input, init) => {
    paths.push(String(input));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer session');
    return Response.json(String(input).endsWith('/me/courses') ? { courses: [course] } : { course });
  } });
  assert.equal((await api.list())[0]?.steps[1]?.full, true);
  assert.equal((await api.get('course-1')).done, 1);
  assert.deepEqual(paths, ['https://api.example.test/me/courses', 'https://api.example.test/me/courses/course-1']);
});

test('unlock sends no client completion assertion and accepts the server result', async () => {
  const api = createCourseApiClient({ ...options, fetcher: async (_input, init) => {
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, '{}');
    return Response.json({ course: { ...course, done: 2, state: 'UNLOCKED', unlockedAt: '2026-10-08T01:00:00Z',
      steps: course.steps.map(step => ({ ...step, done: true })) }, replayed: false });
  } });
  assert.equal((await api.unlock('course-1')).course.state, 'UNLOCKED');
});

test('stale progress is described honestly and malformed server progress is rejected', () => {
  assert.equal(courseChipText(course as ReturnType<typeof parseCourse>), "'식사 후 들르기 좋은 곳' 코스 1/2");
  assert.match(courseStateText({ ...course, state: 'STALE' } as ReturnType<typeof parseCourse>), /장면을 열 수 없어요/);
  assert.throws(() => parseCourse({ ...course, done: 2 }), /INVALID_RESPONSE/);
  assert.throws(() => parseCourse({ ...course, state: 'STALE', stale: false }), /INVALID_RESPONSE/);
});

test('an expired session is invalidated and the HTTP code remains available', async () => {
  let invalidations = 0;
  const api = createCourseApiClient({ ...options, onSessionInvalid: () => { invalidations += 1; },
    fetcher: async () => Response.json({ code: 'SESSION_INVALID' }, { status: 401 }) });
  await assert.rejects(api.list(), (error: unknown) => error instanceof CourseApiError && error.status === 401 && error.code === 'SESSION_INVALID');
  assert.equal(invalidations, 1);
});

test('unlock preserves consent refusal for the shared consent recheck action', async () => {
  const api = createCourseApiClient({ ...options,
    fetcher: async () => Response.json({ code: 'CONSENT_REQUIRED' }, { status: 403 }) });
  await assert.rejects(api.unlock('course-1'), (error: unknown) =>
    error instanceof CourseApiError && error.status === 403 && error.code === 'CONSENT_REQUIRED');
});
