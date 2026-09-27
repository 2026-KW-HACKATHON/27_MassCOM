import { useAuthSession } from '@/auth/auth-provider';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { rememberMerchantReturn } from '@/navigation/showcase-entry';
import { AuthRequiredScreen } from './index';

export function AuthRequiredRoute() {
  const auth = useAuthSession();
  const router = useRouter();
  const { merchantId } = useLocalSearchParams<{ merchantId?: string }>();
  if (auth.state.status === 'signedIn' || auth.state.status === 'demo') return null;
  return <AuthRequiredScreen
    state={auth.state}
    canSignIn={auth.canSignIn}
    onSignIn={async () => {
      rememberMerchantReturn(merchantId);
      try { await auth.signIn(); } catch (error) {
        rememberMerchantReturn(undefined);
        throw error;
      }
    }}
    onBackToBrowse={merchantId ? () => router.replace({ pathname: '/merchants/[merchantId]', params: { merchantId } }) : undefined}
  />;
}
