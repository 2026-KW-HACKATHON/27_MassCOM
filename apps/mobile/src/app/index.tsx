import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { FoundationScreen } from '@/screens/foundation';

export default function FoundationRoute() {
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const [isFocused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  return (
    <FoundationScreen
      initialRole={role === 'customer' || role === 'merchant' ? role : undefined}
      isFocused={isFocused}
      onConnectWallet={() => {
        // Keep only presentation state in the route. Wallet/auth state stays in its providers.
        router.setParams({ role: 'customer' });
        router.push('/wallet');
      }}
    />
  );
}
