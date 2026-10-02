import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  isEmptyVisitorFeedback,
  maxVisitorSuggestions,
  maxVisitorTags,
  normalizeVisitorFeedback,
  publicVisitorTagMinVotes,
  publicVisitorTags,
  rankVisitorCounts,
  visitorFeedbackNoteMaxLength,
  visitorSuggestionCodes,
  visitorSuggestionLabels,
  visitorTagCodes,
  visitorTagLabels,
} from './visitor-feedback-rules.js';

const feedback = (input: { tags?: unknown; suggestions?: unknown; note?: unknown }) =>
  normalizeVisitorFeedback({ tags: [], suggestions: [], note: null, ...input });

test('the tag and suggestion codes and Korean labels are exactly the owner-approved lists, in display order', () => {
  assert.deepEqual(visitorTagCodes, ['SOLO', 'TAKEOUT', 'GENEROUS', 'QUIET', 'KIND', 'VALUE', 'STUDENT', 'DESSERT']);
  assert.deepEqual(visitorTagLabels, {
    SOLO: '혼밥하기 좋아요',
    TAKEOUT: '포장이 편해요',
    GENEROUS: '양이 넉넉해요',
    QUIET: '조용해서 대화하기 좋아요',
    KIND: '친절해요',
    VALUE: '가성비가 좋아요',
    STUDENT: '학생이 가기 좋아요',
    DESSERT: '디저트가 좋아요',
  });
  assert.deepEqual(visitorSuggestionCodes, ['SOLO_MENU', 'SPICE_LABEL', 'MORE_PHOTOS', 'STUDENT_DISCOUNT', 'HOURS_INFO']);
  assert.deepEqual(visitorSuggestionLabels, {
    SOLO_MENU: '혼밥 메뉴가 있으면 좋겠어요',
    SPICE_LABEL: '맵기 표시가 있으면 좋겠어요',
    MORE_PHOTOS: '메뉴 사진이 더 있으면 좋겠어요',
    STUDENT_DISCOUNT: '학생 할인 시간이 있으면 좋겠어요',
    HOURS_INFO: '영업시간 안내가 있으면 좋겠어요',
  });
  assert.equal(maxVisitorTags, 3);
  assert.equal(maxVisitorSuggestions, 2);
  assert.equal(visitorFeedbackNoteMaxLength, 100);
});

test('migration 0040 lists the same codes and limits as the rules module', () => {
  const sql = readFileSync(new URL('../migrations/0040_merchant_visitor_feedback.sql', import.meta.url), 'utf8');
  const arrays = [...sql.matchAll(/ARRAY\[([^\]]*)\]::text\[\],\s*(\d+)/gu)].map((match) => ({
    codes: [...match[1]!.matchAll(/'([A-Z_]+)'/gu)].map((code) => code[1]),
    max: Number(match[2]),
  }));
  assert.deepEqual(arrays, [
    { codes: [...visitorTagCodes], max: maxVisitorTags },
    { codes: [...visitorSuggestionCodes], max: maxVisitorSuggestions },
  ]);
  assert.match(sql, new RegExp(`char_length\\(note\\) <= ${visitorFeedbackNoteMaxLength}`, 'u'));
});

test('tags and suggestions are deduplicated and put in the fixed display order', () => {
  const result = feedback({ tags: ['KIND', 'SOLO', 'KIND', 'DESSERT'], suggestions: ['HOURS_INFO', 'SOLO_MENU', 'HOURS_INFO'] });
  assert.deepEqual(result, {
    ok: true,
    value: { tags: ['SOLO', 'KIND', 'DESSERT'], suggestions: ['SOLO_MENU', 'HOURS_INFO'], note: null },
  });
  // 중복을 접은 뒤 개수를 센다: 같은 코드를 네 번 보내도 한 개다.
  assert.deepEqual(feedback({ tags: ['SOLO', 'SOLO', 'SOLO', 'SOLO'] }), {
    ok: true,
    value: { tags: ['SOLO'], suggestions: [], note: null },
  });
});

test('at most 3 distinct tags and 2 distinct suggestions are accepted', () => {
  assert.equal(feedback({ tags: ['SOLO', 'TAKEOUT', 'GENEROUS'] }).ok, true);
  assert.deepEqual(feedback({ tags: ['SOLO', 'TAKEOUT', 'GENEROUS', 'QUIET'] }), {
    ok: false,
    code: 'VISITOR_FEEDBACK_TAGS_INVALID',
  });
  assert.equal(feedback({ suggestions: ['SOLO_MENU', 'SPICE_LABEL'] }).ok, true);
  assert.deepEqual(feedback({ suggestions: ['SOLO_MENU', 'SPICE_LABEL', 'MORE_PHOTOS'] }), {
    ok: false,
    code: 'VISITOR_FEEDBACK_SUGGESTIONS_INVALID',
  });
});

test('unknown, mis-cased, label-text and non-string codes and non-array values are rejected', () => {
  const badTags: unknown[] = [['UNKNOWN'], ['solo'], ['혼밥하기 좋아요'], [1], [null], [['SOLO']], 'SOLO', null, undefined, {}, 3];
  for (const tags of badTags) {
    assert.deepEqual(feedback({ tags }), { ok: false, code: 'VISITOR_FEEDBACK_TAGS_INVALID' }, JSON.stringify(tags));
  }
  const badSuggestions: unknown[] = [['SOLO'], ['SPICE'], [true], 'HOURS_INFO', null, undefined, {}];
  for (const suggestions of badSuggestions) {
    assert.deepEqual(feedback({ suggestions }), { ok: false, code: 'VISITOR_FEEDBACK_SUGGESTIONS_INVALID' },
      JSON.stringify(suggestions));
  }
  // 태그 코드를 바라는 점으로, 바라는 점 코드를 태그로 보낼 수 없다.
  assert.equal(feedback({ tags: ['SOLO_MENU'] }).ok, false);
  assert.equal(feedback({ suggestions: ['KIND'] }).ok, false);
});

test('the three failures use distinct codes, checked tags, suggestions, then note', () => {
  assert.deepEqual(feedback({ tags: ['X'], suggestions: ['Y'], note: 'a@b.kr' }), { ok: false, code: 'VISITOR_FEEDBACK_TAGS_INVALID' });
  assert.deepEqual(feedback({ suggestions: ['Y'], note: 'a@b.kr' }), { ok: false, code: 'VISITOR_FEEDBACK_SUGGESTIONS_INVALID' });
  assert.deepEqual(feedback({ note: 'a@b.kr' }), { ok: false, code: 'VISITOR_FEEDBACK_NOTE_INVALID' });
});

test('the note is trimmed, whitespace-collapsed, limited to 100 characters, and empty becomes null', () => {
  assert.deepEqual(feedback({ note: '  국물이   진해요 \n 또 올게요 ' }), {
    ok: true,
    value: { tags: [], suggestions: [], note: '국물이 진해요 또 올게요' },
  });
  for (const note of [undefined, null, '', '   ', '\n\t ']) {
    assert.deepEqual(feedback({ note }), { ok: true, value: { tags: [], suggestions: [], note: null } }, JSON.stringify(note));
  }
  assert.equal(feedback({ note: '가'.repeat(100) }).ok, true);
  assert.deepEqual(feedback({ note: '가'.repeat(101) }), { ok: false, code: 'VISITOR_FEEDBACK_NOTE_INVALID' });
  // 100자는 코드 포인트로 센다(이모지 한 글자가 둘로 세어지지 않는다).
  assert.equal(feedback({ note: '😀'.repeat(100) }).ok, true);
  assert.equal(feedback({ note: '😀'.repeat(101) }).ok, false);
  assert.deepEqual(feedback({ note: 7 }), { ok: false, code: 'VISITOR_FEEDBACK_NOTE_INVALID' });
});

test('a note with an email, a web address or a long digit run is rejected by the shared D-051 filter', () => {
  for (const note of [
    'hello@example.com 으로 연락 주세요',
    'https://example.com 에 있어요',
    'instagram.com/mystore 보세요',
    '010-1234-5678 로 전화 주세요',
    '０１０ １２３４ ５６７８',
  ]) {
    assert.deepEqual(feedback({ note }), { ok: false, code: 'VISITOR_FEEDBACK_NOTE_INVALID' }, note);
  }
  // 짧은 숫자(가격·인원)는 괜찮다.
  assert.equal(feedback({ note: '7000원이라 3명이 먹기 좋아요' }).ok, true);
});

test('an all-empty selection is detected so the service can delete the row', () => {
  assert.equal(isEmptyVisitorFeedback({ tags: [], suggestions: [], note: null }), true);
  assert.equal(isEmptyVisitorFeedback({ tags: ['KIND'], suggestions: [], note: null }), false);
  assert.equal(isEmptyVisitorFeedback({ tags: [], suggestions: ['HOURS_INFO'], note: null }), false);
  assert.equal(isEmptyVisitorFeedback({ tags: [], suggestions: [], note: '좋아요' }), false);
});

test('a real store shows a tag publicly from 3 votes and a demo store from 1', () => {
  assert.equal(publicVisitorTagMinVotes(false), 3);
  assert.equal(publicVisitorTagMinVotes(true), 1);
  const counts = [
    { code: 'SOLO', count: 2 },
    { code: 'KIND', count: 3 },
    { code: 'VALUE', count: 1 },
  ];
  assert.deepEqual(publicVisitorTags(counts, false), [{ code: 'KIND', count: 3 }]);
  assert.deepEqual(publicVisitorTags(counts, true), [
    { code: 'KIND', count: 3 },
    { code: 'SOLO', count: 2 },
    { code: 'VALUE', count: 1 },
  ]);
  assert.deepEqual(publicVisitorTags([{ code: 'SOLO', count: 2 }], false), []);
  assert.deepEqual(publicVisitorTags([], true), []);
});

test('counts are sorted by count descending, then by the fixed code order, and unknown codes and zero counts are dropped', () => {
  const ranked = rankVisitorCounts(
    [
      { code: 'DESSERT', count: 4 },
      { code: 'KIND', count: 4 },
      { code: 'SOLO', count: 4 },
      { code: 'QUIET', count: 5 },
      { code: 'TAKEOUT', count: 0 },
      { code: 'UNKNOWN', count: 9 },
    ],
    visitorTagCodes,
    1,
  );
  assert.deepEqual(ranked, [
    { code: 'QUIET', count: 5 },
    { code: 'SOLO', count: 4 },
    { code: 'KIND', count: 4 },
    { code: 'DESSERT', count: 4 },
  ]);
});
