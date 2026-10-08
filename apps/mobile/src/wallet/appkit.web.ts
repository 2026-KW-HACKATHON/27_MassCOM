import { getWalletRuntimeConfig } from './wallet-runtime-config';

// 웹 체험에는 외부 지갑 연결이 없다. Metro가 웹에서 appkit.ts 대신 이 파일을 골라, 지갑 SDK·ethers(번들의 약 3분의 1)가 웹 번들에 들어오지 않는다.
// 프로젝트 ID를 비워 두므로 지갑 화면은 늘 "설정 필요" 안내를 보이고, 계정별 AppKit은 만들지 않는다. 네이티브는 appkit.ts 그대로다.
export const walletRuntimeConfig = getWalletRuntimeConfig({
  EXPO_PUBLIC_REOWN_PROJECT_ID: undefined,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});

export function createAccountScopedAppKit(): null {
  return null;
}
