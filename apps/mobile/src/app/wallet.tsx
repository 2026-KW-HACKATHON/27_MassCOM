import { useAuthSession } from '@/auth/auth-provider';
import { WalletConfigurationRequired } from '@/screens/wallet-link/configuration-required';
import { WalletLinkScreen } from '@/screens/wallet-link';
import { walletRuntimeConfig } from '@/wallet/appkit';
import { AuthRequiredRoute } from '@/screens/auth-required/route';

export default function WalletLinkRoute() {
  const auth = useAuthSession();
  if (!auth.accountId || !auth.credential) return <AuthRequiredRoute />;
  if (!walletRuntimeConfig.available) {
    return <WalletConfigurationRequired missing={[...walletRuntimeConfig.missing]} />;
  }

  return (
    <WalletLinkScreen
      key={auth.accountId}
      config={walletRuntimeConfig}
      credential={auth.credential}
      onSessionInvalid={auth.invalidateSession}
    />
  );
}
