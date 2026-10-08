import { useState } from 'react';
import { Pressable, Switch, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import type { HapticMode, UiSoundSettings } from '@/sound/ui-sounds';
import type { AppColors } from '@/theme/palette';

import type { makeAccountSettingsStyles } from './styles';

type SettingsStyles = ReturnType<typeof makeAccountSettingsStyles>;

type Props = {
  settings: UiSoundSettings;
  styles: SettingsStyles;
  palette: AppColors;
};

const hapticOptions: { mode: HapticMode; label: string; hint: string }[] = [
  { mode: 'OFF', label: '꺼짐', hint: '모든 진동을 끕니다.' },
  { mode: 'DRAW_ONLY', label: '뽑기만', hint: '캐릭터 뽑기 연출에서만 진동합니다.' },
  { mode: 'ALL', label: '전체', hint: '버튼과 보상, 뽑기 연출에서 진동합니다.' },
];

export function SettingsVolume({ settings, styles, palette }: Props) {
  return (
    <View style={styles.soundPanel}>
      <View style={styles.soundRow}>
        <View style={styles.soundCopy}>
          <Text style={styles.sectionTitle}>효과음</Text>
          <Text style={styles.intro}>버튼·화면 이동·보상 획득 효과음. 이 기기에 저장돼요.</Text>
        </View>
        <Switch
          accessibilityLabel="효과음"
          accessibilityHint="버튼, 화면 이동, 보상 획득 효과음을 켜거나 끕니다."
          value={settings.enabled}
          disabled={!settings.ready}
          onValueChange={settings.setEnabled}
          trackColor={{ true: palette.primary, false: palette.separator }}
          thumbColor={palette.surface}
        />
      </View>
      <VolumeControl
        label="효과음 크기"
        value={settings.soundEffectsVolume}
        disabled={!settings.ready || !settings.soundEffectsEnabled}
        onChange={settings.setSoundEffectsVolume}
        styles={styles}
      />
      <View style={styles.soundControlBlock}>
        <View style={styles.soundControlHeader}>
          <View style={styles.soundCopy}>
            <Text style={styles.sectionTitle}>배경음악</Text>
            <Text style={styles.intro}>뽑기 인트로와 반복 음악을 재생합니다.</Text>
          </View>
          <Switch
            accessibilityLabel="배경음악"
            accessibilityHint="뽑기 배경음악을 켜거나 끕니다."
            value={settings.bgmEnabled}
            disabled={!settings.ready}
            onValueChange={settings.setBgmEnabled}
            trackColor={{ true: palette.primary, false: palette.separator }}
            thumbColor={palette.surface}
          />
        </View>
        <VolumeControl
          label="배경음악 크기"
          value={settings.bgmVolume}
          disabled={!settings.ready || !settings.bgmEnabled}
          onChange={settings.setBgmVolume}
          styles={styles}
        />
      </View>
      <View style={styles.soundControlBlock}>
        <Text style={styles.sectionTitle}>진동</Text>
        <View style={styles.segmentRow}>
          {hapticOptions.map((option) => {
            const active = settings.hapticMode === option.mode;
            return (
              <Pressable
                key={option.mode}
                accessibilityRole="button"
                accessibilityLabel={`진동 ${option.label}`}
                accessibilityHint={option.hint}
                accessibilityState={{ selected: active, disabled: !settings.ready }}
                disabled={!settings.ready}
                onPress={() => settings.setHapticMode(option.mode)}
                style={[styles.segmentButton, active && styles.segmentButtonActive, !settings.ready && styles.disabled]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Text style={styles.intro}>화면 움직임 줄이기는 기기의 접근성 설정을 따릅니다.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="소리와 진동 설정 초기화"
        accessibilityHint="효과음과 배경음악 크기, 진동 단계를 기본값으로 되돌립니다."
        disabled={!settings.ready}
        onPress={settings.reset}
        style={[styles.secondaryLink, !settings.ready && styles.disabled]}
      >
        <Text style={styles.secondaryLinkText}>소리·진동 초기화</Text>
      </Pressable>
    </View>
  );
}

function VolumeControl({
  label, value, disabled, onChange, styles,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  styles: SettingsStyles;
}) {
  const [width, setWidth] = useState(1);
  const percent = Math.round(value * 100);

  function setFromEvent(event: GestureResponderEvent) {
    if (disabled) return;
    onChange(Math.min(1, Math.max(0, event.nativeEvent.locationX / width)));
  }

  function onLayout(event: LayoutChangeEvent) {
    setWidth(Math.max(1, event.nativeEvent.layout.width));
  }

  return (
    <View style={styles.soundControlBlock}>
      <View style={styles.volumeLabels}>
        <Text style={styles.inputLabel}>{label}</Text>
        <Text style={styles.volumeText}>{percent}%</Text>
      </View>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') onChange(Math.min(1, value + 0.1));
          if (event.nativeEvent.actionName === 'decrement') onChange(Math.max(0, value - 0.1));
        }}
        disabled={disabled}
        onLayout={onLayout}
        onPress={setFromEvent}
        onPressIn={setFromEvent}
        style={[styles.volumeTrack, disabled && styles.disabled]}
      >
        <View pointerEvents="none" style={styles.volumeBar}>
          <View style={[styles.volumeFill, { width: `${percent}%` }]} />
          <View style={[styles.volumeThumb, { marginLeft: `${Math.max(0, Math.min(100, percent))}%` }]} />
        </View>
      </Pressable>
    </View>
  );
}
