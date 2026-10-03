import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createVisitorFeedbackForm, isEmptyVisitorFeedbackForm, setVisitorFeedbackNote,
  toVisitorFeedbackPayload, toggleVisitorSuggestion, toggleVisitorTag,
} from './visitor-feedback-form';

test('tag and suggestion choices stop at their independent limits and can be deselected', () => {
  let form = createVisitorFeedbackForm();
  for (const code of ['SOLO', 'TAKEOUT', 'GENEROUS', 'QUIET'] as const) form = toggleVisitorTag(form, code);
  assert.deepEqual(form.tags, ['SOLO', 'TAKEOUT', 'GENEROUS']);
  form = toggleVisitorTag(form, 'TAKEOUT');
  form = toggleVisitorTag(form, 'QUIET');
  assert.deepEqual(form.tags, ['SOLO', 'GENEROUS', 'QUIET']);
  for (const code of ['SOLO_MENU', 'SPICE_LABEL', 'MORE_PHOTOS'] as const) form = toggleVisitorSuggestion(form, code);
  assert.deepEqual(form.suggestions, ['SOLO_MENU', 'SPICE_LABEL']);
  assert.deepEqual(toggleVisitorSuggestion(form, 'SOLO_MENU').suggestions, ['SPICE_LABEL']);
});

test('note is capped at 100 characters, trimmed on save, and empty submission withdraws', () => {
  const empty = createVisitorFeedbackForm();
  assert.equal(isEmptyVisitorFeedbackForm(empty), true);
  assert.deepEqual(toVisitorFeedbackPayload(empty), { tags: [], suggestions: [], note: null });
  const withNote = setVisitorFeedbackNote(empty, `  ${'가'.repeat(100)}  `);
  assert.equal(withNote, empty, 'raw input above 100 characters is rejected');
  const accepted = setVisitorFeedbackNote(empty, '  도움이 됐어요  ');
  assert.equal(isEmptyVisitorFeedbackForm(accepted), false);
  assert.equal(toVisitorFeedbackPayload(accepted).note, '도움이 됐어요');
  assert.equal(setVisitorFeedbackNote(empty, '가'.repeat(101)), empty);
  assert.throws(() => toVisitorFeedbackPayload({ ...empty, note: '가'.repeat(101) }), /100자/);
  assert.equal(isEmptyVisitorFeedbackForm(setVisitorFeedbackNote(empty, '  ')), true);
});
