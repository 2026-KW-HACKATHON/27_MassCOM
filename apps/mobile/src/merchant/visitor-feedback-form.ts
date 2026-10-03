import {
  maxVisitorSuggestions, maxVisitorTags, visitorFeedbackNoteMaxLength,
  type VisitorSuggestionCode, type VisitorTagCode,
} from './visitor-feedback-codes';
import type { VisitorFeedbackInput, VisitorFeedbackSelection } from './visitor-feedback-api';

export type VisitorFeedbackForm = {
  tags: readonly VisitorTagCode[];
  suggestions: readonly VisitorSuggestionCode[];
  note: string;
};

export function createVisitorFeedbackForm(selection?: VisitorFeedbackSelection): VisitorFeedbackForm {
  return { tags: selection?.tags ?? [], suggestions: selection?.suggestions ?? [], note: selection?.note ?? '' };
}

export function toggleVisitorTag(form: VisitorFeedbackForm, code: VisitorTagCode): VisitorFeedbackForm {
  if (form.tags.includes(code)) return { ...form, tags: form.tags.filter((tag) => tag !== code) };
  if (form.tags.length >= maxVisitorTags) return form;
  return { ...form, tags: [...form.tags, code] };
}

export function toggleVisitorSuggestion(form: VisitorFeedbackForm, code: VisitorSuggestionCode): VisitorFeedbackForm {
  if (form.suggestions.includes(code)) return { ...form, suggestions: form.suggestions.filter((item) => item !== code) };
  if (form.suggestions.length >= maxVisitorSuggestions) return form;
  return { ...form, suggestions: [...form.suggestions, code] };
}

export function setVisitorFeedbackNote(form: VisitorFeedbackForm, note: string): VisitorFeedbackForm {
  if (Array.from(note).length > visitorFeedbackNoteMaxLength) return form;
  return { ...form, note };
}

export function isEmptyVisitorFeedbackForm(form: VisitorFeedbackForm): boolean {
  return form.tags.length === 0 && form.suggestions.length === 0 && form.note.trim() === '';
}

export function toVisitorFeedbackPayload(form: VisitorFeedbackForm): VisitorFeedbackInput {
  const note = form.note.trim();
  if (Array.from(note).length > visitorFeedbackNoteMaxLength) throw new Error('의견은 100자 이하로 적어 주세요.');
  return { tags: [...form.tags], suggestions: [...form.suggestions], note: note || null };
}
