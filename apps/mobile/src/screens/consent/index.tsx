import * as Application from 'expo-application';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { accountContextLabel } from '@/config/app-context';
import { ConsentApiClient } from '@/privacy/consent-api';
import { consentChecks, consentCopy, consentNotice } from '@/privacy/consent-copy';
import {
  canSubmitConsent,
  loadConsentState,
  noChecks,
  submitConsent,
  type ConsentChecks,
  type ConsentGateState,
} from '@/privacy/consent-flow';
import { colorsForScheme } from '@/theme/palette';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { consentBoxSize, makeConsentStyles } from './styles';

type Props = {
  apiUrl: string;
  credential: AccountCredential;
  /** Called once the server says this account has agreed to the current terms and privacy versions. */
  onAccepted: () => void;
  onLogout: () => Promise<void>;
  onSessionInvalid: () => Promise<void>;
};

/**
 * 첫 로그인 동의 화면(Issue #253, D-059). 운영 앱과 시연 앱이 같은 코드를 쓰며, 서버가 `required`라고 답하는 동안 메인 탭보다 앞에서
 * 전체 화면으로 보인다. 필수 세 개(만 14세 이상, 이용약관, 개인정보 수집·이용)를 모두 눌러야 "동의하고 시작"이 켜진다.
 */
export function ConsentScreen({ apiUrl, credential, onAccepted, onLogout, onSessionInvalid }: Props) {
  const palette = colorsForScheme(useColorScheme());
  const styles = StyleSheet.create(makeConsentStyles(palette, StyleSheet.hairlineWidth));
  const insets = useSafeAreaInsets();
  // 글자를 키우면(최대 200% 이상) 체크 상자도 같은 비율로 커진다. 글자 크기 제한(allowFontScaling=false)은 쓰지 않는다.
  const boxSize = consentBoxSize(useWindowDimensions().fontScale);
  const client = useMemo(() => new ConsentApiClient({ apiUrl, credential }), [apiUrl, credential]);
  const [gate, setGate] = useState<ConsentGateState>({ kind: 'loading' });
  const [checks, setChecks] = useState<ConsentChecks>(noChecks);
  const [busy, setBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let current = true;
    void loadConsentState(client, credential).then((result) => {
      if (!current) return;
      if (result.kind === 'sessionInvalid') void onSessionInvalid();
      else setGate(result.state);
    });
    return () => { current = false; };
    // The session callback is stable for one signed-in account; only a new client or a manual retry should ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, loadAttempt]);

  useEffect(() => {
    if (gate.kind === 'accepted') onAccepted();
  }, [gate.kind, onAccepted]);

  const ready = canSubmitConsent(checks);

  async function submit() {
    if (busy || !ready) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await submitConsent(client, credential, checks);
      if (result.kind === 'sessionInvalid') await onSessionInvalid();
      else if (result.kind === 'submitFailed') setMessage(consentCopy.submitFailed);
      else setGate(result.state);
    } finally {
      setBusy(false);
    }
  }

  async function openLink(url: string) {
    setMessage(undefined);
    try {
      await Linking.openURL(url);
    } catch {
      setMessage(consentCopy.openLinkFailed);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await onLogout();
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <>
      <Text style={styles.eyebrow}>{accountContextLabel(Application.applicationId)}</Text>
    </>
  );

  if (gate.kind === 'loading' || gate.kind === 'accepted') {
    return (
      <SkyScrollView header={undefined} contentContainerStyle={[styles.content, { justifyContent: 'center', paddingBottom: 40 + insets.bottom }]}>
        {header}
        <View accessibilityLiveRegion="polite" style={styles.statusCard}>
          <ActivityIndicator color={palette.primary} />
          <Text selectable style={styles.statusText}>{consentCopy.loading}</Text>
        </View>
      </SkyScrollView>
    );
  }

  if (gate.kind === 'failed' || gate.kind === 'outdated') {
    return (
      <SkyScrollView header={undefined} contentContainerStyle={[styles.content, { justifyContent: 'center', paddingBottom: 40 + insets.bottom }]}>
        {header}
        <View accessibilityLiveRegion="polite" style={styles.statusCard}>
          <Text selectable style={styles.errorText}>
            {gate.kind === 'outdated' ? consentCopy.versionMismatch : consentCopy.checkFailed}
          </Text>
        </View>
        {gate.kind === 'failed' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="동의 상태를 서버에서 다시 읽습니다."
            onPress={() => { setGate({ kind: 'loading' }); setLoadAttempt((attempt) => attempt + 1); }}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>{consentCopy.retry}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityHint="이 기기에서 로그아웃합니다."
          disabled={busy}
          onPress={() => void logout()}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>{consentCopy.logoutNeutral}</Text>
        </Pressable>
      </SkyScrollView>
    );
  }

  return (
    <SkyScrollView header={undefined} contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}>
      {header}
      <Text accessibilityRole="header" selectable style={styles.title}>{consentCopy.title}</Text>
      <Text selectable style={styles.body}>{consentCopy.intro}</Text>

      <View accessible={false} style={styles.noticeCard}>
        <Text accessibilityRole="header" style={styles.noticeHeading}>{consentCopy.noticeTitle}</Text>
        {consentNotice.map((item) => (
          <View key={item.title} style={styles.noticeItem}>
            <Text style={styles.noticeTitle}>{item.title}</Text>
            <Text selectable style={styles.noticeBody}>{item.body}</Text>
          </View>
        ))}
      </View>

      {consentChecks.map((check) => {
        const checked = checks[check.key];
        return (
          <View key={check.key} style={styles.checkGroup}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={check.label}
              accessibilityState={{ checked, disabled: busy }}
              disabled={busy}
              onPress={() => setChecks((current) => ({ ...current, [check.key]: !current[check.key] }))}
              style={styles.checkRow}
            >
              <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.box, { width: boxSize, height: boxSize, minWidth: boxSize, minHeight: boxSize }, checked && styles.boxChecked]}>
                <Text style={styles.tick}>{checked ? '✓' : ''}</Text>
              </View>
              <Text style={styles.checkLabel}>{check.label}</Text>
            </Pressable>
            {check.link ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={check.link.label}
                accessibilityHint={check.link.hint}
                onPress={() => void openLink(check.link!.url)}
                style={styles.link}
              >
                <Text style={styles.linkText}>{check.link.label}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      <View accessibilityLiveRegion="polite">
        {message ? <Text selectable style={styles.errorText}>{message}</Text> : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={busy ? consentCopy.submitting : consentCopy.submit}
        accessibilityHint={ready ? consentCopy.submitReadyHint : consentCopy.submitHint}
        accessibilityState={{ disabled: !ready || busy, busy }}
        disabled={!ready || busy}
        onPress={() => void submit()}
        style={[styles.submit, (!ready || busy) && styles.submitDisabled]}
      >
        {/* numberOfLines={2}: a large system font wraps to a second line instead of being clipped, and the text is
            never shrunk (the screen must follow the font scale). Width: see submitText in styles.ts (Issue #271). */}
        <Text
          numberOfLines={2}
          style={[styles.submitText, (!ready || busy) && styles.submitTextDisabled]}
        >
          {busy ? consentCopy.submitting : consentCopy.submit}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="동의 없이 이 기기에서 로그아웃합니다."
        disabled={busy}
        onPress={() => void logout()}
        style={styles.secondary}
      >
        <Text style={styles.secondaryText}>{consentCopy.logout}</Text>
      </Pressable>
    </SkyScrollView>
  );
}
