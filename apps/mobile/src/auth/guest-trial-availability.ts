export function isGuestTrialAvailable(input: {
  packageId: string | null | undefined;
  platform: 'native' | 'web';
  demoAccountInjected: boolean;
  productionAuthAvailable: boolean;
  publicApiAvailable: boolean;
  approvedOrigin: boolean;
}): boolean {
  if (!input.publicApiAvailable || !input.approvedOrigin) return false;
  if (input.packageId !== 'kr.masscom.wolgye.demo' && input.packageId !== 'kr.masscom.wolgye.dev') return false;
  return input.platform === 'web'
    || input.packageId !== 'kr.masscom.wolgye.dev'
    || !input.demoAccountInjected
    || input.productionAuthAvailable;
}
