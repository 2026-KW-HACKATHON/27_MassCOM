import { getAppPackageId } from '@/config/app-identity';
import { Button, Host } from '@expo/ui';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthControllerError } from '@/auth/auth-controller';
import { statusAnnouncement } from '@/accessibility/status-copy';
import { accountContextLabel } from '@/config/app-context';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { colorsForScheme } from '@/theme/palette';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import type { Props } from './index';
import { makeAuthRequiredStyles } from './styles';

// Web has no Google sign-in (react-native-nitro-google-signin is native-only) and no on-device
// secure storage session to protect, so the web build offers only the guest trial (Issue #309).
// Shares its Props with the native screen so _layout.tsx / route.tsx stay platform-agnostic.
export function AuthRequiredScreen({ state, canStartGuestTrial, onGuestSignIn, onBackToRole, onBackToBrowse, header }: Props) {
  const palette = colorsForScheme(useColorScheme());
  const styles = StyleSheet.create(makeAuthRequiredStyles(palette, StyleSheet.hairlineWidth));
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const restoring = state.status === 'restoring' || state.status === 'switchingAccount';

  async function startGuestTrial() {
    if (busy || !canStartGuestTrial) return;
    setBusy(true);
    setError(undefined);
    try {
      await onGuestSignIn();
    } catch (caught) {
      if (!(caught instanceof AuthControllerError)) {
        setError('체험을 시작하지 못했습니다. 다시 시도해 주세요.');
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
      <Text style={styles.eyebrow}>{accountContextLabel(getAppPackageId())}</Text>
      <Text selectable style={styles.title}>로그인 없이{`\n`}둘러볼 수 있어요.</Text>
      <Text selectable style={styles.body}>
        로그인 없이 체험하기를 누르면 임시 계정으로 탐색과 방문 도감을 바로 써 볼 수 있어요.{`\n`}
        Google 로그인은 Android 앱에서 할 수 있어요.{`\n`}
        체험 기록은 24시간 뒤 사라져요.
      </Text>

      <View accessibilityLiveRegion="polite" style={styles.statusCard}>
        {restoring || busy ? <ActivityIndicator color={palette.primary} /> : null}
        <Text selectable style={styles.statusTitle}>
          {restoring ? '저장된 체험 기록을 확인하는 중입니다.' : configurationRequired
            ? '체험 설정이 필요합니다.' : error ?? reasonMessage(state)}
        </Text>
      </View>

      {!configurationRequired && !restoring ? (
        <Host matchContents seedColor={palette.primary} style={styles.buttonHost}>
          <Button
            label={busy ? '체험 시작 중' : '로그인 없이 체험하기'}
            variant="filled"
            disabled={busy || !canStartGuestTrial}
            onPress={() => void startGuestTrial()}
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
  if (state.status !== 'signedOut' || !state.reason) return '체험 시작이 필요합니다.';
  if (state.reason === 'SECURE_STORAGE_UNAVAILABLE') {
    return '이 브라우저에 체험 기록을 저장할 수 없어 복원하지 않았습니다.';
  }
  return statusAnnouncement('login-failed', { reason: state.reason });
}
