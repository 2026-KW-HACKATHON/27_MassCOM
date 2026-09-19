import { WalletConfigurationRequired } from '@/screens/wallet-link/configuration-required';
import { WalletLinkScreen } from '@/screens/wallet-link';
import { walletRuntimeConfig } from '@/wallet/appkit';

export default function WalletLinkRoute() {
  if (!walletRuntimeConfig.available) {
    return <WalletConfigurationRequired missing={[...walletRuntimeConfig.missing]} />;
  }

  return <WalletLinkScreen config={walletRuntimeConfig} />;
}
