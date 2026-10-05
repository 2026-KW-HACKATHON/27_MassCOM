export type NotificationTarget = '/collection' | `/collection?focus=${string}` | '/merchant' | `/merchants/${string}` | '/notifications';
const identifier = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const rewardLink = new RegExp(`^/collection\\?focus=collectible&entitlement=${identifier}$`);
const couponLink = new RegExp(`^/collection\\?focus=rewards&coupon=${identifier}$`);
export function notificationTarget(path: unknown): NotificationTarget | undefined {
  if (path === '/collection' || path === '/merchant' || path === '/notifications') return path;
  if (path === '/collection?focus=rewards') return path;
  if (typeof path === 'string' && (rewardLink.test(path) || couponLink.test(path))) return path as NotificationTarget;
  if (typeof path === 'string' && /^\/merchants\/[A-Za-z0-9_-]+$/.test(path)) return path as NotificationTarget;
  return undefined;
}
