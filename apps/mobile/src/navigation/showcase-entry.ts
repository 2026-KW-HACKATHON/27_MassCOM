import type { AccountCredential } from '@/auth/account-credential';
import { canOpenMerchantDemo, isDevelopmentDemoBuild, type DemoRuntimeConfig } from '@/config/demo-runtime';

export type ShowcaseRole = 'customer' | 'merchant';
export type ShowcaseRoleState = { role?: ShowcaseRole; accountId?: string };

let pendingMerchantReturn: string | undefined;

export function rememberMerchantReturn(merchantId: string | undefined): void {
  pendingMerchantReturn = merchantId;
}

export function consumeMerchantReturn(): string | undefined {
  const merchantId = pendingMerchantReturn;
  pendingMerchantReturn = undefined;
  return merchantId;
}

export function showShowcaseRoleEntry(
  packageId: string | null | undefined,
  selectedRole?: ShowcaseRole,
): boolean {
  return packageId === 'kr.masscom.wolgye.demo' && selectedRole === undefined;
}

export function reconcileShowcaseAccount(
  state: ShowcaseRoleState,
  accountId: string | undefined,
): ShowcaseRoleState {
  if (state.accountId === accountId) return state;
  return {
    role: state.accountId === undefined ? state.role : undefined,
    accountId,
  };
}

export function showcaseEntryDestination(
  packageId: string | null | undefined,
  selectedRole: ShowcaseRole | undefined,
  authenticated: boolean,
): 'role' | 'auth' | 'customer' | 'merchant' {
  if (showShowcaseRoleEntry(packageId, selectedRole)) return 'role';
  if (packageId === 'kr.masscom.wolgye.demo' && selectedRole === 'merchant') {
    return authenticated ? 'merchant' : 'auth';
  }
  return 'customer';
}

export function canOpenShowcaseTour(packageId: string | null | undefined): boolean {
  return packageId === 'kr.masscom.wolgye.demo';
}

/**
 * The owner art page (D-048) belongs to the showcase app; the operating app is customer-only (AGENTS.md, D-038). The local
 * development build may open it too, like its developer merchant route, so the flow can be checked against a local API.
 */
export function canOpenMerchantArtRoute(packageId: string | null | undefined): boolean {
  return packageId === 'kr.masscom.wolgye.demo' || isDevelopmentDemoBuild(packageId);
}

/**
 * "테스트 방문 만들기" 섹션(#295)은 가상 점포·QR 우회라 시연 앱과 로컬 QA용 개발 빌드에만 보인다(canOpenMerchantArtRoute와
 * 같은 경계: 운영 앱은 절대 아니다). 서버도 같은 showcaseDeployment 판정으로 /showcase/test-visits 자체를 닫는다.
 */
export function canShowTestVisitSection(packageId: string | null | undefined): boolean {
  return packageId === 'kr.masscom.wolgye.demo' || isDevelopmentDemoBuild(packageId);
}

export function canOpenDeveloperMerchantRoute(
  packageId: string | null | undefined,
  credential: AccountCredential | undefined,
  config: DemoRuntimeConfig,
): boolean {
  return isDevelopmentDemoBuild(packageId) && Boolean(credential && canOpenMerchantDemo(credential, config));
}
