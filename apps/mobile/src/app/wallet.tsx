import { useAuthSession } from '@/auth/auth-provider';
import { WalletConfigurationRequired } from '@/screens/wallet-link/configuration-required';
import { WalletLinkScreen } from '@/screens/wallet-link';
import { walletRuntimeConfig } from '@/wallet/appkit';

export default function WalletLinkRoute() {
  const auth = useAuthSession();
  if (!walletRuntimeConfig.available) {
    return <WalletConfigurationRequired missing={[...walletRuntimeConfig.missing]} />;
  }

  if (!auth.accountId || !auth.credential) return null;
  return (
    <WalletLinkScreen
      key={auth.accountId}
      config={walletRuntimeConfig}
      credential={auth.credential}
      onSessionInvalid={auth.logout}
    />
  );
}
