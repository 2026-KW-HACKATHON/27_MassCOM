import type { CollectionCollectible } from './collection.js';

export class StoreTicketError extends Error {
  constructor(readonly code: 'STORE_TICKET_NOT_FOUND' | 'INVALID_REQUEST') {
    super(code);
    this.name = 'StoreTicketError';
  }
}

export interface StoreTicketService {
  list(accountId: string): Promise<{ tickets: readonly CollectionCollectible[] }>;
  open(input: { accountId: string; entitlementId: string }): Promise<{ opened: true; replayed: boolean }>;
}
