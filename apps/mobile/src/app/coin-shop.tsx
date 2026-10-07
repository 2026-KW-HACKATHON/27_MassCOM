import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { CoinShopScreen } from '@/screens/coin-shop';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function CoinShopRoute() {
  const auth = useAuthSession();
  const header = <BackHeader title="가게 코인 뽑기권" />;
  if (!auth.credential || !auth.accountId) return <SkyBackdrop><AuthRequiredRoute header={header} /></SkyBackdrop>;
  if (!publicApiConfig.available) return <SkyBackdrop><SkyScrollView header={header}>
    <DemoConfigurationRequired title="가게 뽑기권 설정이 필요합니다." missing={['EXPO_PUBLIC_API_URL']} />
  </SkyScrollView></SkyBackdrop>;
  return <CoinShopScreen key={auth.accountId} apiUrl={publicApiConfig.apiUrl} accountId={auth.accountId}
    credential={auth.credential} onSessionInvalid={auth.invalidateSession} />;
}
