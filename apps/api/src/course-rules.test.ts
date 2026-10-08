import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCheckSummary, CourseError, courseChipText, courseReasonText, courseUserState, evaluateSteps, parseCourseDraft,
  parseSuggestedHour, publishBlockers, straightLineMeters, summarizeProgress,
  type CourseMerchantFact, type StepEntitlement,
} from './course-rules.js';

const draft = () => ({
  title: '  밥 먹고 한 바퀴 ', situation: 'AFTER_MEAL', sceneKey: 'picnic-1',
  steps: [
    { merchantId: 'm-bowl', pieceLabel: '그릇', ownerOptinRef: 'OPTIN-2026-A1' },
    { merchantId: 'm-cup', targetVisitCount: 3, pieceKey: 'cup', pieceLabel: '컵' },
  ],
});
const invalid = (input: unknown) => assert.throws(() => parseCourseDraft(input),
  (error: unknown) => error instanceof CourseError && error.code === 'COURSE_INVALID_INPUT');

test('a valid draft is trimmed and defaulted: goal 1, piece-N keys, null optional refs and dates', () => {
  assert.deepEqual(parseCourseDraft(draft()), {
    title: '밥 먹고 한 바퀴', situation: 'AFTER_MEAL', sceneKey: 'picnic-1', startsAt: null, endsAt: null, countsFrom: null,
    steps: [
      { merchantId: 'm-bowl', targetVisitCount: 1, pieceKey: 'piece-1', pieceLabel: '그릇', ownerOptinRef: 'OPTIN-2026-A1' },
      { merchantId: 'm-cup', targetVisitCount: 3, pieceKey: 'cup', pieceLabel: '컵', ownerOptinRef: null },
    ],
  });
});

test('a blank opt-in reference from the editor means "not recorded yet", not an invalid value', () => {
  const input = draft();
  input.steps[0] = { merchantId: 'm-bowl', pieceLabel: '그릇', ownerOptinRef: '  ' };
  assert.equal(parseCourseDraft(input).steps[0]!.ownerOptinRef, null);
});

test('a draft needs 2 to 4 distinct stores', () => {
  invalid({ ...draft(), steps: draft().steps.slice(0, 1) });
  invalid({ ...draft(), steps: [] });
  const many = ['a', 'b', 'c', 'd', 'e'].map(id => ({ merchantId: id, pieceLabel: id }));
  invalid({ ...draft(), steps: many });
  assert.equal(parseCourseDraft({ ...draft(), steps: many.slice(0, 4) }).steps.length, 4);
  invalid({ ...draft(), steps: [{ merchantId: 'same', pieceLabel: 'a' }, { merchantId: 'same', pieceLabel: 'b' }] });
});

test('situation, scene key, goals, labels and unknown keys are validated', () => {
  invalid({ ...draft(), situation: 'LUNCH' });
  invalid({ ...draft(), sceneKey: 'Picnic Scene' });
  invalid({ ...draft(), sceneKey: '' });
  invalid({ ...draft(), title: '' });
  invalid({ ...draft(), title: '가'.repeat(41) });
  invalid({ ...draft(), extra: true });
  invalid({ ...draft(), steps: [{ merchantId: 'a', pieceLabel: 'x', targetVisitCount: 2 }, draft().steps[1]] });
  invalid({ ...draft(), steps: [{ merchantId: 'a', pieceLabel: '가'.repeat(21) }, draft().steps[1]] });
  invalid({ ...draft(), steps: [{ merchantId: 'a', pieceLabel: 'x', pieceKey: 'Bad Key' }, draft().steps[1]] });
  invalid({ ...draft(), steps: [{ merchantId: 'a', pieceLabel: 'x', surprise: 1 }, draft().steps[1]] });
  invalid(null);
  invalid([]);
  assert.equal(parseCourseDraft({ ...draft(), title: '가'.repeat(40) }).title.length, 40);
});

test('owner opt-in references keep the document-reference shape and refuse personal-looking values', () => {
  const withRef = (ownerOptinRef: unknown) => ({ ...draft(), steps: [{ merchantId: 'a', pieceLabel: 'x', ownerOptinRef }, draft().steps[1]] });
  invalid(withRef('owner@example.com'));
  invalid(withRef('010-1234-5678'));
  invalid(withRef('12345678'));
  invalid(withRef('ab'));
  invalid(withRef(5));
  assert.equal(parseCourseDraft(withRef(' OPTIN-1 ')).steps[0]!.ownerOptinRef, 'OPTIN-1');
});

test('dates are normalised and the window must run forward', () => {
  const parsed = parseCourseDraft({ ...draft(), startsAt: '2026-10-09T09:00:00+09:00', endsAt: '2026-11-09T00:00:00Z',
    countsFrom: '2026-10-09T00:00:00Z' });
  assert.equal(parsed.startsAt, '2026-10-09T00:00:00.000Z');
  assert.equal(parsed.countsFrom, '2026-10-09T00:00:00.000Z');
  invalid({ ...draft(), startsAt: '2026-10-09T00:00:00Z', endsAt: '2026-10-09T00:00:00Z' });
  invalid({ ...draft(), startsAt: 'tomorrow' });
});

test('suggested hour is an hour of the day or absent', () => {
  assert.equal(parseSuggestedHour(undefined), null);
  assert.equal(parseSuggestedHour(null), null);
  assert.equal(parseSuggestedHour(0), 0);
  assert.equal(parseSuggestedHour(23), 23);
  for (const value of [24, -1, 1.5, '13']) assert.throws(() => parseSuggestedHour(value), CourseError);
});

const entitlement = (merchantId: string, targetVisitCount: number, earnedAt: string, extra: Partial<StepEntitlement> = {}): StepEntitlement => ({
  entitlementId: `e-${merchantId}-${targetVisitCount}-${earnedAt}`, merchantId, targetVisitCount, earnedAt: new Date(earnedAt),
  status: 'GRANTED', ...extra,
});
const steps = [
  { position: 1, merchantId: 'm-bowl', targetVisitCount: 1 },
  { position: 2, merchantId: 'm-cup', targetVisitCount: 3 },
  { position: 3, merchantId: 'm-bag', targetVisitCount: 1 },
];

test('a step is done by a non-cancelled entitlement for that store and that goal, not by anything else', () => {
  const progress = evaluateSteps(steps, [
    entitlement('m-bowl', 1, '2026-10-01T00:00:00Z'),
    entitlement('m-cup', 1, '2026-10-01T00:00:00Z'),
    entitlement('m-bag', 1, '2026-10-02T00:00:00Z', { status: 'CANCELED' }),
  ], null);
  assert.deepEqual(progress.map(step => step.done), [true, false, false]);
  assert.equal(progress[0]!.entitlementId, 'e-m-bowl-1-2026-10-01T00:00:00Z');
  assert.deepEqual(summarizeProgress(progress), { done: 1, total: 3, complete: false, nextPosition: 2 });
});

test('every non-cancelled status counts, including mint states, because the right was earned', () => {
  for (const status of ['GRANTED', 'MINT_REQUESTED', 'FULFILLED']) {
    assert.equal(evaluateSteps([steps[0]!], [entitlement('m-bowl', 1, '2026-10-01T00:00:00Z', { status })], null)[0]!.done, true, status);
  }
});

test('a reversal that cancels the entitlement un-completes the step (the list no longer carries it as live)', () => {
  const live = [entitlement('m-bowl', 1, '2026-10-01T00:00:00Z'), entitlement('m-cup', 3, '2026-10-02T00:00:00Z'),
    entitlement('m-bag', 1, '2026-10-03T00:00:00Z')];
  assert.equal(summarizeProgress(evaluateSteps(steps, live, null)).complete, true);
  const reversed = live.map(item => item.merchantId === 'm-cup' ? { ...item, status: 'CANCELED' } : item);
  assert.deepEqual(summarizeProgress(evaluateSteps(steps, reversed, null)), { done: 2, total: 3, complete: false, nextPosition: 2 });
});

test('counts_from keeps older entitlements out and counts the boundary instant; null counts everything', () => {
  const entitlements = [entitlement('m-bowl', 1, '2026-10-01T00:00:00Z')];
  assert.equal(evaluateSteps([steps[0]!], entitlements, null)[0]!.done, true);
  assert.equal(evaluateSteps([steps[0]!], entitlements, new Date('2026-10-01T00:00:01Z'))[0]!.done, false);
  assert.equal(evaluateSteps([steps[0]!], entitlements, new Date('2026-10-01T00:00:00Z'))[0]!.done, true);
  assert.equal(evaluateSteps([steps[0]!], entitlements, new Date('2026-09-30T00:00:00Z'))[0]!.done, true);
});

test('when a store has several qualifying entitlements the earliest is the evidence', () => {
  const progress = evaluateSteps([steps[0]!], [entitlement('m-bowl', 1, '2026-10-05T00:00:00Z'), entitlement('m-bowl', 1, '2026-10-02T00:00:00Z')], null);
  assert.equal(progress[0]!.earnedAt, '2026-10-02T00:00:00.000Z');
});

test('user state: unlocked but missing a step is STALE, otherwise it follows progress', () => {
  const none = summarizeProgress(evaluateSteps(steps, [], null));
  const some = summarizeProgress(evaluateSteps(steps, [entitlement('m-bowl', 1, '2026-10-01T00:00:00Z')], null));
  const all = summarizeProgress(evaluateSteps(steps, [entitlement('m-bowl', 1, '2026-10-01T00:00:00Z'),
    entitlement('m-cup', 3, '2026-10-01T00:00:00Z'), entitlement('m-bag', 1, '2026-10-01T00:00:00Z')], null));
  assert.equal(courseUserState(none, false), 'NOT_STARTED');
  assert.equal(courseUserState(some, false), 'IN_PROGRESS');
  assert.equal(courseUserState(all, false), 'READY');
  assert.equal(courseUserState(all, true), 'UNLOCKED');
  assert.equal(courseUserState(some, true), 'STALE');
  assert.equal(summarizeProgress([]).complete, false);
});

test('chip and reason text describe the situation without claiming anything else', () => {
  const hint = { situation: 'AFTER_MEAL' as const, done: 2, total: 3 };
  assert.equal(courseChipText(hint), "'식사 후 들르기 좋은 곳' 코스 2/3");
  assert.equal(courseReasonText(hint), "'식사 후 들르기 좋은 곳' 코스 2/3 · 다음은 이 가게예요.");
  assert.equal(courseChipText({ ...hint, situation: 'TAKEOUT' }), "'포장해서 가져가기 좋은 곳' 코스 2/3");
});

test('straight-line distance is plausible (Seoul City Hall to Gwanghwamun is about 1.07 km)', () => {
  const meters = straightLineMeters({ latitude: 37.5663, longitude: 126.9779 }, { latitude: 37.5759, longitude: 126.9769 });
  assert.ok(meters > 1050 && meters < 1090, String(meters));
  assert.equal(straightLineMeters({ latitude: 37, longitude: 127 }, { latitude: 37, longitude: 127 }), 0);
});

const fact = (position: number, extra: Partial<CourseMerchantFact> = {}): CourseMerchantFact => ({
  position, merchantId: `m${position}`, targetVisitCount: 1, exists: true, name: `가게${position}`, category: position === 1 ? '한식' : '카페',
  active: true, published: true, demo: false, guestTrial: false,
  point: { latitude: 37.6 + position * 0.001, longitude: 127.07 },
  campaign: { id: `c${position}`, endsAt: '2027-01-01T00:00:00Z', goals: [1, 3, 5], enrollmentOpen: true, hasCoin: true },
  hours: null, ...extra,
});
const summarize = (facts: CourseMerchantFact[], suggestedHour: number | null = null, courseEndsAt: Date | null = null) =>
  buildCheckSummary({ facts, suggestedHour, evaluatedAt: new Date('2026-10-09T03:00:00Z'), courseEndsAt });
const item = (summary: ReturnType<typeof summarize>, key: string) => summary.items.find(entry => entry.key === key)!;

test('a clean course passes with the hours check skipped when no hour is suggested, and the summary is a labelled snapshot', () => {
  const summary = summarize([fact(1), fact(2)]);
  assert.equal(summary.ok, true);
  assert.equal(summary.failures, 0);
  assert.equal(summary.snapshot, true);
  assert.equal(summary.basis, 'STRAIGHT_LINE');
  assert.match(summary.label, /스냅샷/);
  assert.equal(item(summary, 'HOURS').status, 'SKIPPED');
  assert.equal(item(summary, 'CATEGORY_MIX').status, 'PASS');
  assert.equal(summary.distances.length, 1);
  assert.deepEqual(summary.steps.map(step => step.name), ['가게1', '가게2']);
});

test('demo, guest-trial, unpublished and inactive stores fail the eligibility check', () => {
  for (const extra of [{ demo: true }, { guestTrial: true }, { published: false }, { active: false }, { exists: false }]) {
    const summary = summarize([fact(1), fact(2, extra)]);
    assert.equal(summary.ok, false, JSON.stringify(extra));
    assert.deepEqual(item(summary, 'MERCHANT_ELIGIBLE').positions, [2]);
  }
});

test('a store without an owned location fails and is left out of the distances', () => {
  const summary = summarize([fact(1), fact(2, { point: null }), fact(3)]);
  assert.deepEqual(item(summary, 'LOCATION_OWNED'), { key: 'LOCATION_OWNED', status: 'FAIL', positions: [2], detail: item(summary, 'LOCATION_OWNED').detail });
  assert.deepEqual(summary.distances.map(pair => [pair.from, pair.to]), [[1, 3]]);
  assert.equal(summarize([fact(1), fact(2, { point: null })]).items.find(entry => entry.key === 'DISTANCE')!.status, 'SKIPPED');
});

test('distant stores warn but do not block', () => {
  const summary = summarize([fact(1), fact(2, { point: { latitude: 37.7, longitude: 127.07 } })]);
  assert.equal(item(summary, 'DISTANCE').status, 'WARN');
  assert.equal(summary.ok, true);
  assert.equal(summary.warnings >= 1, true);
});

test('with a suggested hour, anything not open warns, including unknown hours', () => {
  const open = summarize([fact(1, { hours: 'OPEN' }), fact(2, { hours: 'OPEN' })], 13);
  assert.equal(item(open, 'HOURS').status, 'PASS');
  const mixed = summarize([fact(1, { hours: 'OPEN' }), fact(2, { hours: 'UNKNOWN' }), fact(3, { hours: 'CLOSED' })], 13);
  assert.equal(item(mixed, 'HOURS').status, 'WARN');
  assert.deepEqual(item(mixed, 'HOURS').positions, [2, 3]);
  assert.equal(mixed.ok, true);
});

test('one category or none warns; two or more pass', () => {
  assert.equal(item(summarize([fact(1, { category: '카페' }), fact(2, { category: '카페' })]), 'CATEGORY_MIX').status, 'WARN');
  assert.equal(item(summarize([fact(1, { category: null }), fact(2, { category: '  ' })]), 'CATEGORY_MIX').status, 'WARN');
  assert.equal(item(summarize([fact(1), fact(2)]), 'CATEGORY_MIX').status, 'PASS');
});

test('a store without a public campaign carrying the goal fails, as does a full campaign', () => {
  const noCampaign = summarize([fact(1), fact(2, { campaign: null })]);
  assert.deepEqual(item(noCampaign, 'CAMPAIGN_GOAL').positions, [2]);
  assert.equal(noCampaign.ok, false);
  const wrongGoal = summarize([fact(1), fact(2, { targetVisitCount: 5, campaign: { id: 'c', endsAt: '2027-01-01T00:00:00Z', goals: [1, 3], enrollmentOpen: true, hasCoin: true } })]);
  assert.deepEqual(item(wrongGoal, 'CAMPAIGN_GOAL').positions, [2]);
  const full = summarize([fact(1), fact(2, { campaign: { id: 'c', endsAt: '2027-01-01T00:00:00Z', goals: [1, 3, 5], enrollmentOpen: false, hasCoin: true } })]);
  assert.deepEqual(item(full, 'ENROLLMENT_OPEN').positions, [2]);
  assert.equal(full.ok, false);
});

test('campaigns ending soon or before the course ends warn; a missing coin warns', () => {
  const soon = summarize([fact(1), fact(2, { campaign: { id: 'c', endsAt: '2026-10-12T00:00:00Z', goals: [1, 3, 5], enrollmentOpen: true, hasCoin: false } })]);
  assert.equal(item(soon, 'CAMPAIGN_WINDOW').status, 'WARN');
  assert.equal(item(soon, 'COIN_ART').status, 'WARN');
  assert.equal(soon.ok, true);
  const beforeEnd = summarize([fact(1), fact(2)], null, new Date('2027-02-01T00:00:00Z'));
  assert.equal(item(beforeEnd, 'CAMPAIGN_WINDOW').status, 'WARN');
  assert.equal(item(summarize([fact(1), fact(2)], null, new Date('2026-12-01T00:00:00Z')), 'CAMPAIGN_WINDOW').status, 'PASS');
});

const NOW = new Date('2026-10-09T03:00:00Z');
const okSummary = summarize([fact(1), fact(2)]);
const failSummary = summarize([fact(1), fact(2, { demo: true })]);
const publishable = {
  status: 'DRAFT' as const, stepCount: 2, stepsWithoutOptin: 0, endsAt: null, checkedAt: new Date('2026-10-09T02:30:00Z'),
  stored: okSummary, live: okSummary, now: NOW,
};

test('a checked, opted-in, eligible draft is publishable; warnings do not block', () => {
  assert.deepEqual(publishBlockers(publishable), []);
  const warned = summarize([fact(1, { category: '카페' }), fact(2, { category: '카페' })]);
  assert.equal(warned.warnings > 0, true);
  assert.deepEqual(publishBlockers({ ...publishable, stored: warned, live: warned }), []);
  assert.deepEqual(publishBlockers({ ...publishable, status: 'PAUSED' }), []);
});

test('each missing precondition is reported', () => {
  assert.deepEqual(publishBlockers({ ...publishable, status: 'ACTIVE' }), ['COURSE_STATE']);
  assert.deepEqual(publishBlockers({ ...publishable, status: 'ENDED' }), ['COURSE_STATE']);
  assert.deepEqual(publishBlockers({ ...publishable, stepCount: 1 }), ['COURSE_STEP_COUNT']);
  assert.deepEqual(publishBlockers({ ...publishable, stepCount: 5 }), ['COURSE_STEP_COUNT']);
  assert.deepEqual(publishBlockers({ ...publishable, stepsWithoutOptin: 1 }), ['COURSE_OPTIN_MISSING']);
  assert.deepEqual(publishBlockers({ ...publishable, endsAt: new Date('2026-10-09T03:00:00Z') }), ['COURSE_WINDOW_ENDED']);
  assert.deepEqual(publishBlockers({ ...publishable, checkedAt: null, stored: null }), ['COURSE_CHECK_MISSING']);
});

test('a check older than an hour (or from the future) is stale; a failing stored or live check blocks', () => {
  assert.deepEqual(publishBlockers({ ...publishable, checkedAt: new Date('2026-10-09T01:59:59Z') }), ['COURSE_CHECK_STALE']);
  assert.deepEqual(publishBlockers({ ...publishable, checkedAt: new Date('2026-10-09T02:00:00Z') }), []);
  assert.deepEqual(publishBlockers({ ...publishable, checkedAt: new Date('2026-10-09T03:00:01Z') }), ['COURSE_CHECK_STALE']);
  assert.deepEqual(publishBlockers({ ...publishable, stored: failSummary }), ['COURSE_CHECK_FAILED']);
  // The stored check passed but the store has since turned demo/paused: the publish-time recheck catches it.
  assert.deepEqual(publishBlockers({ ...publishable, live: failSummary }), ['COURSE_CHECK_FAILED']);
});
