export type AccountDeletionIntakeService = {
  request(accountId: string): Promise<{ status: 'REQUESTED' }>;
};
