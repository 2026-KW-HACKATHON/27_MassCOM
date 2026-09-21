import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { AccountSettingsScreen } from '@/screens/account-settings';

export default function SettingsRoute() {
  const auth = useAuthSession();
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
    ...(!auth.credential ? ['AUTH_SESSION'] : []),
  ];
  if (!publicApiConfig.available || !auth.credential || !auth.accountId) {
    return <DemoConfigurationRequired title="계정 설정에 API 연결이 필요합니다." missing={missing} />;
  }
  return (
    <AccountSettingsScreen
      key={auth.accountId}
      apiUrl={publicApiConfig.apiUrl}
      accountId={auth.accountId}
      credential={auth.credential}
      destructiveReauthentication={auth.destructiveReauthentication}
      canSwitchAccount={auth.canSignIn}
      onLogout={auth.logout}
      onSwitchAccount={auth.switchAccount}
    />
  );
}
