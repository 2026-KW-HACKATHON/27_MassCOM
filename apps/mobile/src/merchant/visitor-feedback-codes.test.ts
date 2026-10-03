import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { test } from 'node:test';

import {
  maxVisitorSuggestions, maxVisitorTags, visitorFeedbackNoteMaxLength,
  visitorSuggestionOptions, visitorTagOptions,
} from './visitor-feedback-codes';

const apiRules = readFileSync(new URL('../../../api/src/visitor-feedback-rules.ts', import.meta.url), 'utf8');
const reversalRules = readFileSync(new URL('../../../api/src/reversal-rules.ts', import.meta.url), 'utf8');

test('mobile codes, Korean labels, and limits mirror the API source', () => {
  for (const [name, options] of [
    ['visitorTagOptions', visitorTagOptions], ['visitorSuggestionOptions', visitorSuggestionOptions],
  ] as const) {
    const block = apiRules.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`))?.[1];
    assert.ok(block, `API ${name} must exist`);
    const matches = [...block.matchAll(/\{ code: '([^']+)', label: '([^']+)' \}/g)];
    assert.deepEqual(matches.map((match) => ({ code: match[1], label: match[2] })), options);
  }
  assert.equal(Number(apiRules.match(/export const maxVisitorTags = (\d+);/)?.[1]), maxVisitorTags);
  assert.equal(Number(apiRules.match(/export const maxVisitorSuggestions = (\d+);/)?.[1]), maxVisitorSuggestions);
  assert.match(apiRules, /export const visitorFeedbackNoteMaxLength = reversalNoteMaxLength;/);
  assert.equal(Number(reversalRules.match(/export const reversalNoteMaxLength = (\d+);/)?.[1]), visitorFeedbackNoteMaxLength);
});
