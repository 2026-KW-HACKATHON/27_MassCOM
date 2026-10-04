import { useAuthSession } from '@/auth/auth-provider';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { AccountSettingsScreen } from '@/screens/account-settings';
import { AuthRequiredRoute } from '@/screens/auth-required/route';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export default function SettingsRoute() {
  const auth = useAuthSession();
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
  ];
  // 내 정보 is opened from the header avatar, so every state (even signed out) keeps a way back.
  // The header is handed to whichever state renders and lives inside its scroll content, never pinned above it.
  const header = <BackHeader title="내 정보" />;
  return (
    <SkyBackdrop>
      {!auth.credential || !auth.accountId ? <AuthRequiredRoute header={header} />
        : !publicApiConfig.available ? (
          <SkyScrollView header={header}>
            <DemoConfigurationRequired title="계정 설정에 API 연결이 필요합니다." missing={missing} />
          </SkyScrollView>
        )
        : (
          <AccountSettingsScreen
            key={auth.accountId}
            header={header}
            apiUrl={publicApiConfig.apiUrl}
            accountId={auth.accountId}
            credential={auth.credential}
            destructiveReauthentication={auth.destructiveReauthentication}
            canSwitchAccount={auth.canSignIn}
            onLogout={auth.logout}
            onSwitchAccount={auth.switchAccount}
            session={auth.session}
            canStartGuestTrial={auth.canStartGuestTrial}
            onRestartGuestTrial={auth.restartGuestTrial}
          />
        )}
    </SkyBackdrop>
  );
}
