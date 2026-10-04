import { getAppPackageId } from '@/config/app-identity';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AuthSessionState } from '@/auth/auth-provider';
import { accountContextLabel } from '@/config/app-context';
import { useTabBarClearance } from '@/navigation/use-tab-bar-clearance';
import { colorsForScheme } from '@/theme/palette';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyBanner } from '@/ui/sky-banner';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { makeAuthRequiredStyles } from './styles';
import { SignInActions } from './sign-in-actions';

// Shared with index.web.tsx (the web build has no Google sign-in, Issue #309), so both screens
// accept the same props from _layout.tsx / route.tsx regardless of platform.
export type Props = {
  state: Exclude<AuthSessionState, { status: 'signedIn' } | { status: 'demo' }>;
  canSignIn: boolean;
  canStartGuestTrial: boolean;
  onSignIn: () => Promise<void>;
  onGuestSignIn: () => Promise<void>;
  onBackToRole?: () => void;
  onBackToBrowse?: () => void;
  /** Sky header for a page reached from the header avatar; it scrolls with the prompt and lets the sky show through. */
  header?: ReactNode;
};

export function AuthRequiredScreen({ state, canSignIn, canStartGuestTrial, onSignIn, onGuestSignIn, onBackToRole, onBackToBrowse, header }: Props) {
  const palette = colorsForScheme(useColorScheme());
  const styles = StyleSheet.create(makeAuthRequiredStyles(palette, StyleSheet.hairlineWidth));
  const insets = useSafeAreaInsets();
  // Inside the tabs the floating bar covers the bottom edge; at the root there is no bar and this stays 40 + inset.
  const clearance = useTabBarClearance();
  return (
    <SkyBackdrop>
    <SkyScrollView
      header={header ?? <SkyBanner />}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(40 + insets.bottom, clearance) }]}
    >
      <Text style={styles.eyebrow}>{accountContextLabel(getAppPackageId())}</Text>
      <Text selectable style={styles.title}>방문 기록을 안전하게{`\n`}이어서 확인합니다.</Text>
      <Text selectable style={styles.body}>
        Google 계정으로 로그인하면 로그인 후 서버가 발급한 보안 토큰만 기기의 보안 저장소에 보관해요. 지갑이 없어도 음식점 탐색과 방문 도감은 사용할 수 있어요.
      </Text>

      <SignInActions
        state={state}
        canSignIn={canSignIn}
        canStartGuestTrial={canStartGuestTrial}
        onSignIn={onSignIn}
        onGuestSignIn={onGuestSignIn}
      />
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
