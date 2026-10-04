import { Button, Host } from '@expo/ui';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { statusAnnouncement } from '@/accessibility/status-copy';
import { AuthControllerError } from '@/auth/auth-controller';
import type { AuthSessionState } from '@/auth/auth-provider';
import { guestTrialDescription, guestTrialFailureMessage, guestTrialStartLabel } from '@/auth/guest-trial-copy';
import { colorsForScheme } from '@/theme/palette';
import { FloatingCard } from '@/ui/floating-card';
import { makeAuthRequiredStyles } from './styles';

export type SignInActionsProps = {
  state: Exclude<AuthSessionState, { status: 'signedIn' } | { status: 'demo' }>;
  canSignIn: boolean;
  canStartGuestTrial: boolean;
  onSignIn: () => Promise<void>;
  onGuestSignIn: () => Promise<void>;
};

export function SignInActions({ state, canSignIn, canStartGuestTrial, onSignIn, onGuestSignIn }: SignInActionsProps) {
  const palette = colorsForScheme(useColorScheme());
  const styles = StyleSheet.create(makeAuthRequiredStyles(palette, StyleSheet.hairlineWidth));
  const [busyAction, setBusyAction] = useState<'google' | 'guest'>();
  const [error, setError] = useState<string>();
  const restoring = state.status === 'restoring' || state.status === 'switchingAccount';
  const unavailable = state.status === 'signedOut'
    && (state.reason === 'CONFIGURATION_REQUIRED' || state.reason === 'WEB_SHOWCASE_ONLY');
  const hasActions = !restoring && !unavailable;

  async function signIn() {
    if (busyAction || !canSignIn || restoring) return;
    setBusyAction('google');
    setError(undefined);
    try {
      await onSignIn();
    } catch (caught) {
      if (!(caught instanceof AuthControllerError)) {
        setError('로그인을 완료하지 못했습니다. 다시 시도해 주세요.');
      }
    } finally {
      setBusyAction(undefined);
    }
  }

  async function startGuestTrial() {
    if (busyAction || !canStartGuestTrial || restoring) return;
    setBusyAction('guest');
    setError(undefined);
    try {
      await onGuestSignIn();
    } catch (caught) {
      if (!(caught instanceof AuthControllerError)) {
        setError('체험을 시작하지 못했습니다. 다시 시도해 주세요.');
      }
    } finally {
      setBusyAction(undefined);
    }
  }

  const statusText = restoring
    ? '저장된 로그인을 확인하는 중입니다.'
    : error ?? reasonMessage(state, canSignIn, canStartGuestTrial);

  return (
    <View style={styles.actions}>
      <View accessibilityLiveRegion="polite">
        <FloatingCard style={styles.statusCard}>
          {restoring || busyAction ? <ActivityIndicator color={palette.primary} /> : null}
          <Text selectable style={styles.statusTitle}>{statusText}</Text>
        </FloatingCard>
      </View>
      {hasActions && canSignIn ? (
        <Host matchContents seedColor={palette.primary} style={styles.buttonHost}>
          <Button
            label={busyAction === 'google' ? '로그인 중' : 'Google로 로그인'}
            variant="filled"
            disabled={!!busyAction}
            onPress={() => void signIn()}
          />
        </Host>
      ) : null}
      {hasActions && canStartGuestTrial ? (
        <View style={styles.guestActionGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={guestTrialStartLabel}
            accessibilityState={{ disabled: !!busyAction, busy: busyAction === 'guest' }}
            disabled={!!busyAction}
            onPress={() => void startGuestTrial()}
            style={styles.guestButton}
          >
            <Text style={styles.guestButtonLabel}>{busyAction === 'guest' ? '체험 시작 중' : guestTrialStartLabel}</Text>
          </Pressable>
          <Text selectable style={styles.guestDescription}>{guestTrialDescription}</Text>
        </View>
      ) : null}
    </View>
  );
}

function reasonMessage(state: SignInActionsProps['state'], canSignIn: boolean, canStartGuestTrial: boolean): string {
  if (state.status !== 'signedOut' || !state.reason) {
    if (canStartGuestTrial) return canSignIn ? 'Google 로그인 또는 임시 체험을 시작할 수 있어요.' : '임시 체험을 시작할 수 있어요.';
    return 'Google 로그인이 필요합니다.';
  }
  if (state.reason === 'CONFIGURATION_REQUIRED') return 'Google 로그인 설정이 필요합니다.';
  if (state.reason === 'SERVER_SESSION_REVOCATION_FAILED') {
    return '이 기기에서는 로그아웃됐지만 로그인 해지 확인은 아직 받지 못했어요. 이전 로그인이 만료 전까지 유효할 수 있어요.';
  }
  if (state.reason === 'ACCOUNT_SWITCH_UNCHANGED') {
    return '같은 Google 계정을 다시 선택했습니다. 다른 계정으로 바꾸려면 다시 시도해 주세요.';
  }
  if (state.reason === 'WALLET_STORAGE_CLEANUP_FAILED') {
    return '이 기기의 이전 지갑 연결 정보를 모두 지우지 못해 계정 전환을 중지했습니다.';
  }
  if (state.reason.startsWith('GUEST_TRIAL_') || state.reason === 'SECURE_STORAGE_UNAVAILABLE'
    || (canStartGuestTrial && state.reason === 'SIGN_IN_FAILED')) {
    return guestTrialFailureMessage(state.reason, Platform.OS === 'web' ? 'web' : 'native');
  }
  return statusAnnouncement('login-failed', { reason: state.reason });
}
