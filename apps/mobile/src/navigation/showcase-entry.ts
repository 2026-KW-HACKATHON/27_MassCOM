import type { AccountCredential } from '@/auth/account-credential';
import { canOpenMerchantDemo, isDevelopmentDemoBuild, type DemoRuntimeConfig } from '@/config/demo-runtime';

export type ShowcaseRole = 'customer' | 'merchant';
export type ShowcaseRoleState = { role?: ShowcaseRole; accountId?: string };

export type InternalAuthReturn = {
  pathname: '/claim' | '/merchants/[merchantId]'; params: { merchantId: string };
};
let pendingMerchantReturn: InternalAuthReturn | undefined;

export function rememberMerchantReturn(merchantId: string | undefined): void {
  pendingMerchantReturn = merchantId ? { pathname: '/merchants/[merchantId]', params: { merchantId } } : undefined;
}

export function consumeMerchantReturn(): string | undefined {
  const merchantId = pendingMerchantReturn?.params.merchantId;
  pendingMerchantReturn = undefined;
  return merchantId;
}

export function rememberInternalAuthReturn(pathname: string, merchantId: string | undefined): void {
  pendingMerchantReturn = merchantId ? {
    pathname: pathname === '/claim' ? '/claim' : '/merchants/[merchantId]', params: { merchantId },
  } : undefined;
}

export function consumeInternalAuthReturn(): InternalAuthReturn | undefined {
  const target = pendingMerchantReturn;
  pendingMerchantReturn = undefined;
  return target;
}

export function showShowcaseRoleEntry(
  packageId: string | null | undefined,
  selectedRole?: ShowcaseRole,
): boolean {
  // 로컬 QA의 development 빌드도 같은 역할 선택 문을 쓴다(Issue #294 리뷰 #5): 그렇지 않으면 아래
  // showcaseEntryDestination의 dev-package 분기가 selectedRole을 영영 받을 수 없어 닿지 않는 코드가 된다.
  return (packageId === 'kr.masscom.wolgye.demo' || packageId === 'kr.masscom.wolgye.dev') && selectedRole === undefined;
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
