import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, useColorScheme, useWindowDimensions, View } from 'react-native';

import { useMotionEnabled } from '@/motion/use-motion';
import { colorsForScheme } from '@/theme/palette';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';
import { BounceButton } from '@/ui/bounce-button';
import { mealDateLabel, mealDateOptions, mealTimeOptions, mealToday, type MealPickerOption } from './meal-picker-state';

type PickerProps = { label: string; value: string; onChange: (value: string) => void; disabled?: boolean };

export function MealDatePicker({ label, value, onChange, disabled }: PickerProps) {
  const [draft, setDraft] = useState<string>();
  const [today, setToday] = useState(mealToday());
  const [dayCount, setDayCount] = useState(366);
  const options = useMemo(() => mealDateOptions(today, dayCount), [today, dayCount]);

  return <>
    <PickerField label={label} value={value ? mealDateLabel(value) : '날짜 선택'} disabled={disabled} onPress={() => {
      const nextToday = mealToday();
      setToday(nextToday);
      const selected = value >= nextToday ? value : nextToday;
      setDayCount(Math.max(366, Math.ceil((Date.parse(selected) - Date.parse(nextToday)) / 86_400_000) + 1));
      setDraft(selected);
    }} />
    {draft !== undefined ? <PickerDialog label={label} selected={mealDateLabel(draft, today)} onCancel={() => setDraft(undefined)} onConfirm={() => { onChange(draft); setDraft(undefined); }}>
      <NumberWheel label="날짜" options={options} value={draft} onChange={setDraft} />
      <BounceButton label="이후 날짜 더 보기" variant="secondary" onPress={() => setDayCount(dayCount + 366)} />
    </PickerDialog> : null}
  </>;
}

export function MealTimePicker({ label, value, onChange, disabled, minTime = '00:00', maxTime = '23:59' }: PickerProps & { minTime?: string; maxTime?: string }) {
  const [draft, setDraft] = useState<string>();
  const times = useMemo(() => mealTimeOptions(minTime, maxTime), [minTime, maxTime]);
  const hours = useMemo(() => [...new Set(times.map(time => time.slice(0, 2)))].map(hour => ({ value: hour, label: `${Number(hour)}시` })), [times]);
  const hour = draft?.slice(0, 2);
  const minutes = times.filter(time => time.slice(0, 2) === hour).map(time => ({ value: time.slice(3), label: `${Number(time.slice(3))}분` }));

  return <>
    <PickerField label={label} value={value || '시간 선택'} disabled={disabled || times.length === 0} onPress={() => setDraft(times.includes(value) ? value : times[0])} />
    {draft !== undefined ? <PickerDialog label={label} selected={draft} onCancel={() => setDraft(undefined)} onConfirm={() => { onChange(draft); setDraft(undefined); }}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <NumberWheel label="시" options={hours} value={hour!} onChange={nextHour => {
          const candidate = `${nextHour}:${draft.slice(3)}`;
          setDraft(times.includes(candidate) ? candidate : times.find(time => time.slice(0, 2) === nextHour)!);
        }} />
        <NumberWheel key={hour} label="분" options={minutes} value={draft.slice(3)} onChange={minute => setDraft(`${hour}:${minute}`)} />
      </View>
    </PickerDialog> : null}
  </>;
}

function PickerField({ label, value, onPress, disabled }: { label: string; value: string; onPress: () => void; disabled?: boolean }) {
  const palette = colorsForScheme(useColorScheme());
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${value}`} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ minHeight: uiMetrics.minTouch, borderWidth: 1, borderColor: palette.secondaryLabel, borderRadius: 12, padding: 12, gap: 4, backgroundColor: pressed ? palette.primaryContainer : palette.surface })}>
    <Text style={{ color: palette.secondaryLabel, fontSize: 13 }}>{label}</Text>
    <Text style={{ color: palette.label, fontWeight: '800', fontSize: 18 }}>{value} ▾</Text>
  </Pressable>;
}

function PickerDialog({ label, selected, children, onCancel, onConfirm }: { label: string; selected: string; children: ReactNode; onCancel: () => void; onConfirm: () => void }) {
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const world = worldForScheme(scheme);
  const motion = useMotionEnabled();
  return <Modal transparent animationType={motion ? 'fade' : 'none'} onRequestClose={onCancel}>
    <View style={{ flex: 1, backgroundColor: '#102C3AC0', justifyContent: 'center', padding: 20 }}>
      <ScrollView style={{ flexGrow: 0, flexShrink: 1, maxHeight: '95%', width: '100%', maxWidth: 420, alignSelf: 'center', backgroundColor: world.card, borderRadius: 24 }} contentContainerStyle={{ padding: 18, gap: 12 }}>
        <View accessibilityViewIsModal onAccessibilityEscape={onCancel} style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={{ color: palette.label, fontSize: 20, fontWeight: '900' }}>{label}</Text>
          <Text style={{ color: palette.secondaryLabel }}>숫자를 위아래로 밀어 선택하세요.</Text>
          {children}
          <Text accessibilityLiveRegion="polite" style={{ color: palette.primary, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>선택: {selected}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><BounceButton label="취소" variant="secondary" onPress={onCancel} /></View>
            <View style={{ flex: 1 }}><BounceButton label="선택 완료" onPress={onConfirm} /></View>
          </View>
        </View>
      </ScrollView>
    </View>
  </Modal>;
}

function NumberWheel({ label, value, options, onChange }: { label: string; value: string; options: MealPickerOption[]; onChange: (value: string) => void }) {
  const palette = colorsForScheme(useColorScheme());
  const { fontScale } = useWindowDimensions();
  const rowHeight = Math.max(uiMetrics.minTouch, Math.ceil(uiMetrics.minTouch * fontScale));
  const scroll = useRef<ScrollView>(null);
  const index = Math.max(0, options.findIndex(option => option.value === value));
  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(options.length - 1, next));
    if (options[bounded]) {
      onChange(options[bounded].value);
      scroll.current?.scrollTo({ y: bounded * rowHeight, animated: false });
    }
  };

  return <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} 이전 값`} disabled={index === 0} accessibilityState={{ disabled: index === 0 }} onPress={() => goTo(index - 1)} style={{ minHeight: uiMetrics.minTouch, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: palette.primary, fontSize: 22 }}>⌃</Text>
    </Pressable>
    <View accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: options.length - 1, now: index, text: options[index]?.label }}
      aria-valuemin={0} aria-valuemax={options.length - 1} aria-valuenow={index} aria-valuetext={options[index]?.label}
      accessibilityActions={[{ name: 'increment', label: '다음 값' }, { name: 'decrement', label: '이전 값' }]}
      onAccessibilityAction={({ nativeEvent }) => goTo(index + (nativeEvent.actionName === 'increment' ? 1 : -1))}
      style={{ height: rowHeight * 3, overflow: 'hidden', borderRadius: 12, backgroundColor: palette.surface }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: rowHeight, height: rowHeight, left: 0, right: 0, borderTopWidth: 2, borderBottomWidth: 2, borderColor: palette.primary, backgroundColor: palette.primaryContainer }} />
      <ScrollView ref={scroll} nestedScrollEnabled showsVerticalScrollIndicator={false} snapToInterval={rowHeight} decelerationRate="fast" scrollEventThrottle={16}
        contentContainerStyle={{ paddingVertical: rowHeight }}
        onLayout={() => scroll.current?.scrollTo({ y: index * rowHeight, animated: false })}
        onScroll={({ nativeEvent }) => {
          const next = Math.max(0, Math.min(options.length - 1, Math.round(nativeEvent.contentOffset.y / rowHeight)));
          if (options[next] && next !== index) onChange(options[next].value);
        }}
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {options.map(option => <View key={option.value} style={{ height: rowHeight, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }}>
          <Text style={{ color: option.value === value ? palette.onPrimaryContainer : palette.secondaryLabel, fontSize: 18, fontWeight: option.value === value ? '900' : '400', textAlign: 'center' }}>{option.label}</Text>
        </View>)}
      </ScrollView>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} 다음 값`} disabled={index === options.length - 1} accessibilityState={{ disabled: index === options.length - 1 }} onPress={() => goTo(index + 1)} style={{ minHeight: uiMetrics.minTouch, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: palette.primary, fontSize: 22 }}>⌄</Text>
    </Pressable>
  </View>;
}
