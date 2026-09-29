import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { AccountSettingsScreen } from '@/screens/account-settings';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';

export default function SettingsRoute() {
  const auth = useAuthSession();
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
  ];
  // 내 정보 is opened from the header avatar, so every state (even signed out) keeps a way back.
  return (
    <SkyBackdrop>
      <BackHeader title="내 정보" />
      {!auth.credential || !auth.accountId ? <AuthRequiredRoute />
        : !publicApiConfig.available ? <DemoConfigurationRequired title="계정 설정에 API 연결이 필요합니다." missing={missing} />
        : (
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
        )}
    </SkyBackdrop>
  );
}
