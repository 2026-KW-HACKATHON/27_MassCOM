import type { NotificationTarget } from './navigation';

let pending: { accountId: string; target: NotificationTarget } | undefined;
const listeners = new Set<() => void>();
let merchantRoleAccountId: string | undefined;
const merchantListeners = new Set<() => void>();

export function queueNotificationTarget(accountId: string, target: NotificationTarget): void {
  pending = { accountId, target };
  for (const listener of listeners) listener();
}
export function consumeNotificationTarget(accountId: string): NotificationTarget | undefined {
  const value = pending;
  pending = undefined;
  return value?.accountId === accountId ? value.target : undefined;
}
export function subscribeNotificationTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function queueMerchantNotificationRole(accountId: string): void {
  merchantRoleAccountId = accountId;
  for (const listener of merchantListeners) listener();
}
export function consumeMerchantNotificationRole(accountId: string): boolean {
  const matched = merchantRoleAccountId === accountId;
  merchantRoleAccountId = undefined;
  return matched;
}
export function subscribeMerchantNotificationRole(listener: () => void): () => void {
  merchantListeners.add(listener);
  return () => { merchantListeners.delete(listener); };
}
