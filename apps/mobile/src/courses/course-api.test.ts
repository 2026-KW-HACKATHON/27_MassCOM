import assert from 'node:assert/strict';
import { test } from 'node:test';
import { courseListIsNotConfigured, createCourseApiClient, CourseApiError, parseCourse } from './course-api';
import { courseChipText, courseStateText, merchantCourseChip } from './course-copy';
import { clearedCourseDetail } from './course-detail-state';

const course = {
  id: 'course-1', title: '동네 산책', situation: 'AFTER_MEAL', situationLabel: '식사 후 들르기 좋은 곳',
  sceneKey: 'town-evening', status: 'ACTIVE', startsAt: null, endsAt: null, done: 1, total: 2,
  state: 'IN_PROGRESS', stale: false, unlockedAt: null,
  steps: [
    { position: 1, merchantId: 'store-1', merchantName: '가게 A', targetVisitCount: 1, pieceKey: 'first', pieceLabel: '첫 조각', done: true,
      earnedAt: '2026-10-08T00:00:00Z', progressVisitCount: 1, full: false, state: 'AVAILABLE' },
    { position: 2, merchantId: 'store-2', merchantName: '가게 B', targetVisitCount: 3, pieceKey: 'second', pieceLabel: '둘째 조각', done: false,
      earnedAt: null, progressVisitCount: 1, full: true, state: 'AVAILABLE' },
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
  for (const status of ['PAUSED', 'ENDED'] as const) {
    assert.equal(courseChipText(parseCourse({ ...course, status })), "지난 코스 · '식사 후 들르기 좋은 곳' 코스 1/2");
  }
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

test('missing detail clears cached course and scene, while transient errors preserve retryable state', () => {
  for (const status of [404, 410]) {
    const cached = { courses: [parseCourse(course)] as ReturnType<typeof parseCourse>[] | undefined, sceneOpen: true };
    const cleared = clearedCourseDetail(new CourseApiError(status, 'COURSE_UNAVAILABLE'));
    assert.deepEqual({ ...cached, ...cleared }, { courses: undefined, sceneOpen: false });
  }
  assert.equal(clearedCourseDetail(new CourseApiError(503, 'DATABASE_UNAVAILABLE')), undefined);
  assert.equal(clearedCourseDetail(new Error('network')), undefined);
});

test('older APIs without courses are treated as an empty optional course read', () => {
  assert.equal(courseListIsNotConfigured(new CourseApiError(404, 'NOT_FOUND')), true);
  assert.equal(courseListIsNotConfigured(new CourseApiError(503, 'COURSES_NOT_CONFIGURED')), true);
  assert.equal(courseListIsNotConfigured(new CourseApiError(503, 'DATABASE_UNAVAILABLE')), false);
});

test('merchant chip selects only ACTIVE courses containing the current merchant', () => {
  const parsed = parseCourse(course);
  assert.equal(merchantCourseChip([parsed], 'store-2'), "'식사 후 들르기 좋은 곳' 코스의 한 곳이에요");
  assert.equal(merchantCourseChip([parsed], 'other'), undefined);
  assert.equal(merchantCourseChip([{ ...parsed, status: 'PAUSED' }], 'store-2'), undefined);
});

test('unavailable course step is not counted as completable, while an existing unlock can remain visible', () => {
  const unavailable = { ...course, done: 0, steps: [{ ...course.steps[0], done: false, state: 'UNAVAILABLE' }, course.steps[1]] };
  assert.equal(parseCourse(unavailable).steps[0]?.state, 'UNAVAILABLE');
  assert.equal(parseCourse({ ...unavailable, state: 'UNLOCKED', unlockedAt: '2026-10-08T01:00:00Z' }).state, 'UNLOCKED');
  assert.throws(() => parseCourse({ ...course, steps: [{ ...course.steps[0], state: 'UNAVAILABLE' }, course.steps[1]] }), /INVALID_RESPONSE/);
  assert.throws(() => parseCourse({ ...unavailable, steps: [{ ...unavailable.steps[0], state: 'UNKNOWN' }, unavailable.steps[1]] }), /INVALID_RESPONSE/);
});

test('non-JSON older API errors retain HTTP status and do not mask course fallback behavior', async () => {
  for (const body of [null, '<html>not found</html>']) {
    const api = createCourseApiClient({ ...options, fetcher: async () => new Response(body, { status: 404 }) });
    await assert.rejects(api.list(), (error: unknown) => courseListIsNotConfigured(error));
    await assert.rejects(api.get('course-1'), (error: unknown) => Boolean(clearedCourseDetail(error)));
  }
  const unavailable = createCourseApiClient({ ...options, fetcher: async () => Response.json({ code: 'COURSES_NOT_CONFIGURED' }, { status: 503 }) });
  await assert.rejects(unavailable.list(), (error: unknown) => courseListIsNotConfigured(error));
  const other = createCourseApiClient({ ...options, fetcher: async () => Response.json({ code: 'DATABASE_UNAVAILABLE' }, { status: 503 }) });
  await assert.rejects(other.list(), (error: unknown) => error instanceof CourseApiError && error.status === 503 && !courseListIsNotConfigured(error));
});
