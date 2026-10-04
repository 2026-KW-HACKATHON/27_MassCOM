import { Button, Host } from '@expo/ui';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthControllerError } from '@/auth/auth-controller';
import { guestTrialFailureMessage } from '@/auth/guest-trial-copy';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { colorsForScheme } from '@/theme/palette';
import { FloatingCard } from '@/ui/floating-card';
import { Mascot } from '@/ui/mascot';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyBanner } from '@/ui/sky-banner';
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
  // CONFIGURATION_REQUIRED: API URL이 없는 빌드. WEB_SHOWCASE_ONLY: 승인된 패키지·origin 조합이
  // 아니어서(PR #313 리뷰, 2차 방어선) 체험 로그인 자체를 열지 않은 빌드. 둘 다 버튼을 보이지 않는다.
  const unavailable = state.status === 'signedOut'
    && (state.reason === 'CONFIGURATION_REQUIRED' || state.reason === 'WEB_SHOWCASE_ONLY');

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

  // restoring·busy·실패(혹은 WEB_SHOWCASE_ONLY 같은) 사유가 있을 때만 상태 카드를 보인다 — 할 일이
  // 없는데도 뜨는 회색 상자는 오류처럼 보인다는 지적(PR #313 리뷰)을 반영했다.
  const statusText = restoring
    ? '저장된 체험 기록을 확인하는 중입니다.'
    : error ?? (state.status === 'signedOut' && state.reason ? reasonMessage(state) : undefined);

  return (
    <SkyBackdrop>
    <SkyScrollView
      header={header ?? <SkyBanner />}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(40 + insets.bottom, clearance) }]}
    >
      <Text style={styles.eyebrow}>웹 체험</Text>
      <Mascot pose="wave" size={96} accessibilityLabel="손을 흔드는 마스코트" />
      <Text selectable style={styles.title}>로그인 없이{`\n`}둘러볼 수 있어요.</Text>
      <Text selectable style={styles.body}>
        로그인 없이 체험하기를 누르면 임시 계정으로 탐색과 방문 도감을 바로 써 볼 수 있어요.{`\n`}
        Google 로그인은 Android 앱에서, 체험 기록은 24시간 뒤 사라져요.
      </Text>

      {statusText ? (
        <View accessibilityLiveRegion="polite">
          <FloatingCard style={styles.statusCard}>
            {restoring || busy ? <ActivityIndicator color={palette.primary} /> : null}
            <Text selectable style={styles.statusTitle}>{statusText}</Text>
          </FloatingCard>
        </View>
      ) : null}

      {!unavailable && !restoring ? (
        <Host seedColor={palette.primary} style={{ minHeight: 56, width: '100%' }}>
          <Button
            label={busy ? '체험 시작 중' : '로그인 없이 체험하기'}
            variant="filled"
            disabled={busy || !canStartGuestTrial}
            onPress={() => void startGuestTrial()}
            style={{ height: 56, width: '100%' }}
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
    </SkyBackdrop>
  );
}

function reasonMessage(state: Props['state']): string {
  if (state.status !== 'signedOut' || !state.reason) return '체험 시작이 필요합니다.';
  return guestTrialFailureMessage(state.reason, 'web');
}
