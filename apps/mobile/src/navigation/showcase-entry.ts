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
  // 로컬 QA(scripts/qa-local.sh)의 development 빌드도 이 문으로 점주 화면에 닿는다(Issue #294). 운영 package는 이 목록에 없다.
  if ((packageId === 'kr.masscom.wolgye.demo' || packageId === 'kr.masscom.wolgye.dev') && selectedRole === 'merchant') {
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

export function canOpenDeveloperMerchantRoute(
  packageId: string | null | undefined,
  credential: AccountCredential | undefined,
  config: DemoRuntimeConfig,
): boolean {
  return isDevelopmentDemoBuild(packageId) && Boolean(credential && canOpenMerchantDemo(credential, config));
}
