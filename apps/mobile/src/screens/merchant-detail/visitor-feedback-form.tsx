import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';

import { VisitorFeedbackApiError, type VisitorFeedbackSelection, type createVisitorFeedbackApiClient } from '@/merchant/visitor-feedback-api';
import {
  maxVisitorSuggestions,
  maxVisitorTags,
  visitorFeedbackNoteMaxLength,
  visitorSuggestionOptions,
  visitorTagOptions,
} from '@/merchant/visitor-feedback-codes';
import {
  createVisitorFeedbackForm,
  setVisitorFeedbackNote,
  toVisitorFeedbackPayload,
  toggleVisitorSuggestion,
  toggleVisitorTag,
} from '@/merchant/visitor-feedback-form';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';

type Props = {
  merchantId: string;
  client: ReturnType<typeof createVisitorFeedbackApiClient>;
  initialSelection: VisitorFeedbackSelection;
  onClose: () => void;
  onSaved: () => void;
  onNotEligible: () => void;
  onUnauthorized?: () => void;
  editContext?: boolean;
};

export function VisitorFeedbackForm({ merchantId, client, initialSelection, onClose, onSaved, onNotEligible, onUnauthorized, editContext = false }: Props) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const styles = useMemo(() => StyleSheet.create({
    card: { gap: 12, padding: 18, borderRadius: world.radius.card, backgroundColor: world.card },
    heading: { color: world.cardInk, fontSize: 18, fontWeight: '900' },
    groupHeading: { color: world.cardInk, fontSize: 14, fontWeight: '800' },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: world.radius.chip, backgroundColor: palette.primaryContainer },
    chipSelected: { backgroundColor: palette.primary },
    chipText: { color: palette.onPrimaryContainer, fontSize: 13, fontWeight: '700' },
    chipTextSelected: { color: palette.onPrimary },
    input: { minHeight: 96, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.separator, color: world.cardInk, textAlignVertical: 'top' },
    counter: { alignSelf: 'flex-end', color: world.cardMuted, fontSize: 12 },
    privacy: { color: world.cardMuted, fontSize: 13, lineHeight: 20 },
    error: { color: palette.error, fontSize: 13, lineHeight: 20 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    save: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 12, backgroundColor: palette.primary },
    saveText: { color: palette.onPrimary, fontSize: 14, fontWeight: '800' },
    close: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 12, backgroundColor: palette.primaryContainer },
    closeText: { color: palette.onPrimaryContainer, fontSize: 14, fontWeight: '800' },
  }), [palette, world]);
  const [form, setForm] = useState(() => createVisitorFeedbackForm(initialSelection));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteLength = Array.from(form.note).length;
  const requestVersion = useRef(0);
  useEffect(() => () => { requestVersion.current += 1; }, [client, merchantId]);

  async function save() {
    if (saving) return;
    const version = ++requestVersion.current;
    setSaving(true);
    setError(null);
    try {
      await client.save(merchantId, toVisitorFeedbackPayload(form));
      if (requestVersion.current === version) onSaved();
    } catch (cause) {
      if (requestVersion.current !== version) return;
      if (cause instanceof VisitorFeedbackApiError) {
        if (cause.status === 401 && onUnauthorized) {
          onUnauthorized();
        } else if (cause.code === 'NOT_ELIGIBLE') {
          setError('방문 인증한 가게에서만 고를 수 있어요.');
          onNotEligible();
        } else if (cause.code === 'NOTE_REJECTED') {
          setError('연락처·주소처럼 보이는 내용은 보낼 수 없어요.');
        } else if (cause.code === 'RATE_LIMITED') {
          setError('잠시 후 다시 시도해 주세요.');
        } else if (cause.code === 'INVALID') {
          setError('선택한 내용을 확인해 주세요.');
        } else {
          setError('저장하지 못했어요. 다시 시도해 주세요.');
        }
      } else {
        setError('저장하지 못했어요. 다시 시도해 주세요.');
      }
    } finally {
      if (requestVersion.current === version) setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>이 가게는 어땠나요?</Text>
      <Text style={styles.groupHeading}>방문자들이 고른 특징 (최대 {maxVisitorTags}개)</Text>
      <View style={styles.row}>
        {visitorTagOptions.map(({ code, label }) => {
          const selected = form.tags.includes(code);
          return <FeedbackChip key={code} label={label} selected={selected} disabled={saving} styles={styles} onPress={() => setForm((current) => toggleVisitorTag(current, code))} />;
        })}
      </View>
      <Text style={styles.groupHeading}>사장님께 바라는 점 (최대 {maxVisitorSuggestions}개)</Text>
      <View style={styles.row}>
        {visitorSuggestionOptions.map(({ code, label }) => {
          const selected = form.suggestions.includes(code);
          return <FeedbackChip key={code} label={label} selected={selected} disabled={saving} styles={styles} onPress={() => setForm((current) => toggleVisitorSuggestion(current, code))} />;
        })}
      </View>
      <Text style={styles.groupHeading}>짧은 의견 (선택)</Text>
      <TextInput
        accessibilityLabel="사장님께 남기는 짧은 의견"
        multiline
        editable={!saving}
        placeholder="의견을 적어 주세요"
        placeholderTextColor={world.cardMuted}
        value={form.note}
        onChangeText={(note) => setForm((current) => setVisitorFeedbackNote(current, note))}
        style={styles.input}
      />
      <Text accessibilityLabel={`의견 ${noteLength}/${visitorFeedbackNoteMaxLength}자`} style={styles.counter}>{noteLength}/{visitorFeedbackNoteMaxLength}</Text>
      <Text style={styles.privacy}>의견과 바라는 점은 이 가게 점주·직원에게만 보여요. 연락처·주소 같은 개인정보는 적지 마세요.</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="방문 의견 저장" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => { void save(); }} style={styles.save}>
          <Text style={styles.saveText}>저장</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={onClose} style={styles.close}>
          <Text style={styles.closeText}>{editContext ? '닫기' : '건너뛰기'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function FeedbackChip({ label, selected, disabled, styles, onPress }: {
  label: string;
  selected: boolean;
  disabled: boolean;
  styles: { chip: ViewStyle; chipSelected: ViewStyle; chipText: TextStyle; chipTextSelected: TextStyle };
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.chip, selected ? styles.chipSelected : null]}>
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{selected ? `✓ ${label}` : label}</Text>
    </Pressable>
  );
}
