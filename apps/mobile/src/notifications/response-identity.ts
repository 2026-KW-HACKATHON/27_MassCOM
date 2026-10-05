export type NotificationResponseDomain = 'notification' | 'social';

export type NotificationResponseIdentity = {
  domain: NotificationResponseDomain;
  payloadId: string;
  requestIdentifier: string;
  actionIdentifier: string;
};

type ExpoNotificationsWithLastResponse = {
  getLastNotificationResponse?: () => unknown;
  clearLastNotificationResponse?: () => void;
};

const mailIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function notificationResponseIdentity(response: unknown, domain: NotificationResponseDomain): NotificationResponseIdentity | null {
  if (!isRecord(response)) return null;
  const notification = isRecord(response.notification) ? response.notification : undefined;
  const request = notification && isRecord(notification.request) ? notification.request : undefined;
  const content = request && isRecord(request.content) ? request.content : undefined;
  const data = content && isRecord(content.data) ? content.data : undefined;
  const payloadId = domain === 'social' ? socialPayloadId(data) : notificationPayloadId(data);
  if (!payloadId) return null;
  const requestIdentifier = typeof request?.identifier === 'string' && request.identifier.length > 0 ? request.identifier : payloadId;
  const actionIdentifier = typeof response.actionIdentifier === 'string' && response.actionIdentifier.length > 0 ? response.actionIdentifier : '';
  return { domain, payloadId, requestIdentifier, actionIdentifier };
}

export function notificationResponseIdentityKey(identity: NotificationResponseIdentity): string {
  return JSON.stringify([identity.domain, identity.payloadId, identity.requestIdentifier, identity.actionIdentifier]);
}

export function clearLastNotificationResponseIfCurrent(Notifications: ExpoNotificationsWithLastResponse, expected: NotificationResponseIdentity): boolean {
  if (typeof Notifications.getLastNotificationResponse !== 'function' || typeof Notifications.clearLastNotificationResponse !== 'function') return false;
  let current: unknown;
  try {
    current = Notifications.getLastNotificationResponse();
  } catch {
    return false;
  }
  const actual = notificationResponseIdentity(current, expected.domain);
  if (!actual || notificationResponseIdentityKey(actual) !== notificationResponseIdentityKey(expected)) return false;
  try {
    Notifications.clearLastNotificationResponse();
    return true;
  } catch {
    return false;
  }
}

function socialPayloadId(data: Record<string, unknown> | undefined): string | null {
  return typeof data?.mailId === 'string' && mailIdPattern.test(data.mailId) ? data.mailId : null;
}

function notificationPayloadId(data: Record<string, unknown> | undefined): string | null {
  return typeof data?.notificationId === 'string' && data.notificationId.length > 0 ? data.notificationId : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
