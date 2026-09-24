export type ShowcaseRole = 'customer' | 'merchant';
export type ShowcaseRoleState = { role?: ShowcaseRole; accountId?: string };

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
  if (!authenticated) return 'auth';
  return packageId === 'kr.masscom.wolgye.demo' && selectedRole === 'merchant'
    ? 'merchant'
    : 'customer';
}

export function canOpenShowcaseTour(packageId: string | null | undefined): boolean {
  return packageId === 'kr.masscom.wolgye.demo';
}
