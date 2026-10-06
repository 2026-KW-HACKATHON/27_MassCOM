import { useAuthSession } from '@/auth/auth-provider';
import { RealMapScreen } from '../real-map';

/** List and map share one discovery query, selection, and cursor. */
export function MerchantListScreen({ apiUrl }: { apiUrl: string }) {
  const auth = useAuthSession();
  return <RealMapScreen apiUrl={apiUrl} credential={auth.credential} onSessionInvalid={auth.invalidateSession} initialMode="list" />;
}

export { MerchantApiConfigurationRequired } from './merchant-api-configuration';
