import { CommerceApiError, type createCommerceApiClient } from '@/commerce/commerce-api';
import type { PendingClaim } from '@/commerce/claim-pending';

/** Issued identities are consumed; replay is the recovery contract, not fresh QR resolution. */
export function restoreStaffClaim(
  api: Pick<ReturnType<typeof createCommerceApiClient>, 'issueOrReissueIdentityClaim'>,
  pending: PendingClaim,
  isCurrent: () => boolean = () => true,
) {
  return api.issueOrReissueIdentityClaim({ merchantId: pending.merchantId, customerIdentityToken: pending.token })
    .then(result => isCurrent() ? result : undefined);
}

export function terminalStaffClaimError(error: unknown): boolean {
  return error instanceof CommerceApiError && ['CUSTOMER_IDENTITY_EXPIRED','CUSTOMER_IDENTITY_UNAVAILABLE','CLAIM_SLOT_NOT_REISSUABLE'].includes(error.code);
}
