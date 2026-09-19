import { demoRuntimeConfig } from '@/config/demo-runtime';
import { publicApiConfig } from '@/config/public-api-runtime';
import { DemoConfigurationRequired } from '@/screens/demo-configuration-required';
import { AccountSettingsScreen } from '@/screens/account-settings';

export default function SettingsRoute() {
  const missing = [
    ...(!publicApiConfig.available ? ['EXPO_PUBLIC_API_URL'] : []),
    ...(!demoRuntimeConfig.customerAccountId ? ['EXPO_PUBLIC_DEMO_ACCOUNT_ID'] : []),
  ];
  if (!publicApiConfig.available || !demoRuntimeConfig.customerAccountId) {
    return <DemoConfigurationRequired title="계정 설정에 API 연결이 필요합니다." missing={missing} />;
  }
  return (
    <AccountSettingsScreen
      key={demoRuntimeConfig.customerAccountId}
      apiUrl={publicApiConfig.apiUrl}
      accountId={demoRuntimeConfig.customerAccountId}
      allowInsecureDemoReauthentication
    />
  );
}
