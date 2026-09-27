export type CustomerIdentity = { token: string; expiresAt: string };

export type ResolvedCustomerIdentity = { customerAccountId: string; expiresAt: string };

export interface CustomerIdentityService {
  create(accountId: string): Promise<CustomerIdentity>;
  resolve(input: { token: string; merchantId: string; staffAccountId: string }): Promise<ResolvedCustomerIdentity>;
  revoke(input: { token: string; accountId: string }): Promise<void>;
}

export type CustomerIdentityErrorCode =
  | 'CUSTOMER_IDENTITY_UNAVAILABLE'
  | 'CUSTOMER_IDENTITY_EXPIRED'
  | 'ACCOUNT_DELETED';

export class CustomerIdentityError extends Error {
  constructor(readonly code: CustomerIdentityErrorCode) {
    super(code);
    this.name = 'CustomerIdentityError';
  }
}
