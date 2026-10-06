import type { ReactNode } from 'react';
import { useAuthSession } from '@/auth/auth-provider';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { rememberInternalAuthReturn, rememberMerchantReturn } from '@/navigation/showcase-entry';
import { AuthRequiredScreen } from './index';

export function AuthRequiredRoute({ header }: { header?: ReactNode }) {
  const auth = useAuthSession();
  const router = useRouter();
  const pathname = usePathname();
  const { merchantId } = useLocalSearchParams<{ merchantId?: string }>();
  if (auth.state.status === 'signedIn' || auth.state.status === 'demo') return null;
  return <AuthRequiredScreen
    header={header}
    state={auth.state}
    canSignIn={auth.canSignIn}
    canStartGuestTrial={auth.canStartGuestTrial}
    onSignIn={async () => {
      rememberInternalAuthReturn(pathname, merchantId);
      try { await auth.signIn(); } catch (error) {
        rememberMerchantReturn(undefined);
        throw error;
      }
    }}
    onGuestSignIn={async () => {
      rememberInternalAuthReturn(pathname, merchantId);
      try { await auth.signInAsGuest(); } catch (error) {
        rememberMerchantReturn(undefined);
        throw error;
      }
    }}
    onBackToBrowse={merchantId ? () => router.replace({ pathname: '/merchants/[merchantId]', params: { merchantId } }) : undefined}
  />;
}
