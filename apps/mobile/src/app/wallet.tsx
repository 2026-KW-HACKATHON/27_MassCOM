import { useAuthSession } from '@/auth/auth-provider';
import { WalletConfigurationRequired } from '@/screens/wallet-link/configuration-required';
import { WalletLinkScreen } from '@/screens/wallet-link';
import { walletRuntimeConfig } from '@/wallet/appkit';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { BackHeader } from '@/ui/back-header';

export default function WalletLinkRoute() {
  const auth = useAuthSession();
  // The native stack header is hidden for this page, so every state carries its own way back inside its scroll content.
  if (!auth.accountId || !auth.credential) return <AuthRequiredRoute header={<BackHeader title="외부 지갑 연결" />} />;
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
