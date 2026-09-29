import * as Application from 'expo-application';
import { Button, Host } from '@expo/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AuthSessionState } from '@/auth/auth-provider';
import { AuthControllerError } from '@/auth/auth-controller';
import { statusAnnouncement } from '@/accessibility/status-copy';
import { accountContextLabel } from '@/config/app-context';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { colorsForScheme } from '@/theme/palette';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { makeAuthRequiredStyles } from './styles';

type Props = {
  state: Exclude<AuthSessionState, { status: 'signedIn' } | { status: 'demo' }>;
  canSignIn: boolean;
  onSignIn: () => Promise<void>;
  onBackToRole?: () => void;
  onBackToBrowse?: () => void;
  /** Sky header for a page reached from the header avatar; it scrolls with the prompt and lets the sky show through. */
  header?: ReactNode;
};

export function AuthRequiredScreen({ state, canSignIn, onSignIn, onBackToRole, onBackToBrowse, header }: Props) {
  const palette = colorsForScheme(useColorScheme());
  const styles = StyleSheet.create(makeAuthRequiredStyles(palette, StyleSheet.hairlineWidth));
  const insets = useSafeAreaInsets();
  // Inside the tabs the floating bar covers the bottom edge; at the root there is no bar and this stays 40 + inset.
  const clearance = useTabBarClearance();
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
      // The controller publishes known failure reasons; a local fallback must not hide them.
      if (!(caught instanceof AuthControllerError)) {
        setError('로그인을 완료하지 못했습니다. 다시 시도해 주세요.');
      }
    } finally {
      setBusy(false);
    }
  }

  const configurationRequired = state.status === 'signedOut'
    && state.reason === 'CONFIGURATION_REQUIRED';
  return (
    <SkyScrollView
      header={header}
      contentContainerStyle={[styles.content, header ? { backgroundColor: 'transparent' } : null, { paddingBottom: Math.max(40 + insets.bottom, clearance) }]}
    >
      <Text style={styles.eyebrow}>{accountContextLabel(Application.applicationId)}</Text>
      <Text selectable style={styles.title}>방문 기록을 안전하게{`\n`}이어서 확인합니다.</Text>
      <Text selectable style={styles.body}>
        Google 계정으로 로그인하면 로그인 후 서버가 발급한 보안 토큰만 기기의 보안 저장소에 보관해요. 지갑이 없어도 음식점 탐색과 방문 도감은 사용할 수 있어요.
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
      {onBackToBrowse ? <Pressable accessibilityRole="button" onPress={onBackToBrowse} style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: palette.primary, fontSize: 16, fontWeight: '700' }}>음식점으로 돌아가기</Text>
      </Pressable> : null}
    </SkyScrollView>
  );
}

function reasonMessage(state: Props['state']): string {
  if (state.status !== 'signedOut' || !state.reason) return 'Google 로그인이 필요합니다.';
  if (state.reason === 'SECURE_STORAGE_UNAVAILABLE') {
    return '기기 보안 저장소를 사용할 수 없어 로그인 정보를 복원하지 않았습니다.';
  }
  if (state.reason === 'SERVER_SESSION_REVOCATION_FAILED') {
    return '이 기기에서는 로그아웃됐지만 로그인 해지 확인은 아직 받지 못했어요. 이전 로그인이 만료 전까지 유효할 수 있어요.';
  }
  if (state.reason === 'GOOGLE_SIGN_IN_CANCELLED') {
    return statusAnnouncement('login-failed', { reason: state.reason });
  }
  if (state.reason === 'ACCOUNT_SWITCH_UNCHANGED') {
    return '같은 Google 계정을 다시 선택했습니다. 다른 계정으로 바꾸려면 다시 시도해 주세요.';
  }
  if (state.reason === 'WALLET_STORAGE_CLEANUP_FAILED') {
    return '이 기기의 이전 지갑 연결 정보를 모두 지우지 못해 계정 전환을 중지했습니다.';
  }
  return statusAnnouncement('login-failed', { reason: state.reason });
}
