import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { FoundationScreen } from '@/screens/foundation';

export default function FoundationPreviewRoute() {
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const [isFocused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <FoundationScreen
      initialRole={role === 'customer' || role === 'merchant' ? role : undefined}
      isFocused={isFocused}
      onConnectWallet={() => {
        router.setParams({ role: 'customer' });
        router.push('/wallet');
      }}
    />
  );
}
