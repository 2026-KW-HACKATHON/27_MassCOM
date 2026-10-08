import { CommerceApiError, type MerchantContext } from '@/commerce/commerce-api';

export function showcaseOwnerMerchantIds(access: { trialMerchantId: string | null; practiceMerchantId: string | null }): string[] {
  return [access.trialMerchantId ?? access.practiceMerchantId].filter((id): id is string => Boolean(id));
}

export async function findShowcaseStaffMerchant(
  merchantIds: readonly string[],
  getContext: (merchantId: string) => Promise<MerchantContext>,
): Promise<MerchantContext | undefined> {
  for (const merchantId of merchantIds) {
    try {
      const context = await getContext(merchantId);
      if (context.merchantId !== merchantId) throw new Error('MERCHANT_CONTEXT_MISMATCH');
      if (context.permissions.includes('CONFIRM_VISIT')) return context;
    } catch (error) {
      if (error instanceof CommerceApiError && error.status === 403 && error.code === 'MERCHANT_ACCESS_DENIED') continue;
      throw error;
    }
  }
  return undefined;
}
