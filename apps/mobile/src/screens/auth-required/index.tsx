import * as Application from 'expo-application';
import { Button, Host } from '@expo/ui';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AuthSessionState } from '@/auth/auth-provider';
import { accountContextLabel } from '@/config/app-context';
import { colorsForScheme } from '@/theme/palette';
import { makeAuthRequiredStyles } from './styles';

type Props = {
  state: Exclude<AuthSessionState, { status: 'signedIn' } | { status: 'demo' }>;
  canSignIn: boolean;
  onSignIn: () => Promise<void>;
  onBackToRole?: () => void;
};

export function AuthRequiredScreen({ state, canSignIn, onSignIn, onBackToRole }: Props) {
  const palette = colorsForScheme(useColorScheme());
  const styles = StyleSheet.create(makeAuthRequiredStyles(palette, StyleSheet.hairlineWidth));
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const restoring = state.status === 'restoring' || state.status === 'switchingAccount';

  async function signIn() {
    if (busy || !canSignIn) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSignIn();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  const configurationRequired = state.status === 'signedOut'
    && state.reason === 'CONFIGURATION_REQUIRED';
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
    >
      <Text style={styles.eyebrow}>{accountContextLabel(Application.applicationId)}</Text>
      <Text selectable style={styles.title}>방문 기록을 안전하게{`\n`}이어서 확인합니다.</Text>
      <Text selectable style={styles.body}>
        Google 계정 확인 뒤 서버가 발급한 session만 기기의 보안 저장소에 보관합니다. 지갑이 없어도 음식점 탐색과 방문 도감은 사용할 수 있습니다.
      </Text>

      <View accessibilityLiveRegion="polite" style={styles.statusCard}>
        {restoring || busy ? <ActivityIndicator color={palette.primary} /> : null}
        <Text selectable style={styles.statusTitle}>
          {restoring ? '저장된 로그인을 확인하는 중입니다.' : configurationRequired
            ? 'Google 로그인 설정이 필요합니다.' : error ?? reasonMessage(state)}
        </Text>
      </View>

      {!configurationRequired && !restoring ? (
        <Host matchContents seedColor={palette.primary} style={styles.buttonHost}>
          <Button
            label={busy ? '로그인 중' : 'Google로 로그인'}
            variant="filled"
            disabled={busy || !canSignIn}
            onPress={() => void signIn()}
          />
        </Host>
      ) : null}
      {onBackToRole ? <Pressable accessibilityRole="button" onPress={onBackToRole} style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: palette.primary, fontSize: 16, fontWeight: '700' }}>역할 다시 선택</Text>
      </Pressable> : null}
    </ScrollView>
  );
}

function reasonMessage(state: Props['state']): string {
  if (state.status !== 'signedOut' || !state.reason) return 'Google 로그인이 필요합니다.';
  if (state.reason === 'SECURE_STORAGE_UNAVAILABLE') {
    return '기기 보안 저장소를 사용할 수 없어 로그인 정보를 복원하지 않았습니다.';
  }
  if (state.reason === 'SERVER_SESSION_REVOCATION_FAILED') {
    return '이 기기에서는 로그아웃됐지만 서버 세션 해지를 확인하지 못했습니다. 이전 세션은 만료 전까지 유효할 수 있습니다.';
  }
  if (state.reason === 'GOOGLE_SIGN_IN_CANCELLED') return 'Google 로그인을 취소했습니다.';
  if (state.reason === 'ACCOUNT_SWITCH_UNCHANGED') {
    return '같은 Google 계정을 다시 선택했습니다. 다른 계정으로 바꾸려면 다시 시도해 주세요.';
  }
  if (state.reason === 'WALLET_STORAGE_CLEANUP_FAILED') {
    return '이 기기의 이전 지갑 연결 정보를 모두 지우지 못해 계정 전환을 중지했습니다.';
  }
  return '로그인을 완료하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.';
}

function messageFor(error: unknown): string {
  return error instanceof Error && error.message === 'GOOGLE_SIGN_IN_CANCELLED'
    ? 'Google 로그인을 취소했습니다.'
    : '로그인을 완료하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.';
}
