export const notificationCategories = ['REWARD_AVAILABLE', 'COUPON_EXPIRING', 'CAMPAIGN_EXPIRING'] as const;
export type NotificationCategory = typeof notificationCategories[number];
export type NotificationPreferences = {
  pushEnabled: boolean;
  rewardAvailable: boolean;
  couponExpiring: boolean;
  campaignExpiring: boolean;
};
export type NotificationItem = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  targetPath: string;
  createdAt: string;
  readAt: string | null;
};
export type NotificationInput = {
  accountId: string;
  category: NotificationCategory;
  dedupeKey: string;
  title: string;
  body: string;
  targetPath: string;
  /** Internal scheduler metadata; never supplied by an HTTP client. */
  source?: { kind: NotificationCategory; id: string; expiresAt?: string };
};
export class NotificationError extends Error {
  constructor(readonly code: 'INVALID_NOTIFICATION' | 'NOT_FOUND') { super(code); }
}
export interface NotificationService {
  list(accountId: string): Promise<NotificationItem[]>;
  preferences(accountId: string): Promise<NotificationPreferences>;
  updatePreferences(accountId: string, patch: Partial<NotificationPreferences>): Promise<NotificationPreferences>;
  registerDevice(accountId: string, deviceId: string, token: string, platform: 'android', sessionToken: string): Promise<void>;
  unregisterDevice(accountId: string, deviceId: string, sessionToken: string): Promise<void>;
  markRead(accountId: string, id: string): Promise<void>;
  enqueue(input: NotificationInput): Promise<boolean>;
  enqueueDueReminders(): Promise<number>;
  pruneExpired(): Promise<void>;
  deliverDue(limit?: number): Promise<{ sent: number; failed: number; skipped: number }>;
}

const identifier = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const allowedPaths = new RegExp(`^/(?:collection(?:\\?focus=(?:rewards(?:&coupon=${identifier})?|collectible&entitlement=${identifier}))?|merchants/[A-Za-z0-9_-]+|merchant|notifications)$`);
export function validateNotification(input: NotificationInput): void {
  if (input.source && (input.source.kind !== input.category || !input.source.id.trim()
    || input.source.id.length > 180 || (input.source.expiresAt !== undefined && !Number.isFinite(Date.parse(input.source.expiresAt)))
    || (input.source.kind !== 'REWARD_AVAILABLE' && !input.source.expiresAt))) throw new NotificationError('INVALID_NOTIFICATION');
  if (!input.accountId.trim() || !input.dedupeKey.trim() || input.dedupeKey.length > 180
    || !notificationCategories.includes(input.category) || !input.title.trim() || !input.body.trim()
    || input.title.length > 100 || input.body.length > 240 || !allowedPaths.test(input.targetPath)
    || input.targetPath.includes('..') || input.targetPath.includes('//')) {
    throw new NotificationError('INVALID_NOTIFICATION');
  }
}
