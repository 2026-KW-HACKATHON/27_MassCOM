import { AppKitProvider } from '@reown/appkit-react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Fragment, type PropsWithChildren, useCallback } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthSession } from '@/auth/auth-provider';
import { canRenderScreen } from './screen-access';
import { AuthRequiredScreen } from '@/screens/auth-required';
import { colorsForScheme } from '@/theme/palette';

export function RouteBoundary({ name, children }: PropsWithChildren<{ name: string }>) {
  const auth = useAuthSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = colorsForScheme(useColorScheme());
  const allowed = canRenderScreen(name, auth.state.status);

  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!allowed || (name === 'wallet' && !router.canGoBack())) {
        if (router.canGoBack()) router.back();
        else router.replace('/');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [allowed, name, router]));

  if (name === 'index' || name === 'open') return <>{children}</>;
  if (allowed) return (
    <Fragment key={auth.accountId}>
      {auth.appKit
        ? <AppKitProvider instance={auth.appKit}>{children}</AppKitProvider>
        : children}
    </Fragment>
  );
  if (auth.state.status === 'signedIn' || auth.state.status === 'demo') return null;

  // Keep the navigator and destination mounted, but never mount protected content before auth.
  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <AuthRequiredScreen state={auth.state} canSignIn={auth.canSignIn} onSignIn={auth.signIn} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="로그인하지 않고 시작 화면으로 돌아가기"
        onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
        style={[styles.return, { marginBottom: Math.max(insets.bottom, 16) }]}
      >
        <Text style={{ color: palette.primary, fontSize: 16, fontWeight: '600' }}>시작 화면으로 돌아가기</Text>
      </Pressable>
    </View>
  );
}

export function WalletBackButton() {
  const router = useRouter();
  const palette = colorsForScheme(useColorScheme());
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="외부지갑 화면에서 돌아가기"
      onPress={() => router.canGoBack() ? router.back() : router.replace('/')}
      style={styles.back}
    >
      <Text style={{ color: palette.label, fontSize: 16 }}>‹ 돌아가기</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  return: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginHorizontal: 24 },
  back: { minWidth: 80, minHeight: 48, justifyContent: 'center', paddingRight: 12 },
});
