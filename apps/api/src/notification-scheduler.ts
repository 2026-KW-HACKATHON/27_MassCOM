import type { NotificationService } from './notifications.js';

/** Reminders are rebuilt from source rows; dedupe keys make retries and multiple API replicas safe. */
export function startNotificationScheduler(
  notifications: Pick<NotificationService, 'enqueueDueReminders' | 'deliverDue' | 'pruneExpired'>,
  options: { intervalMs?: number; onError?: (code: string) => void } = {},
): () => void {
  const intervalMs = options.intervalMs ?? 60_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new RangeError('invalid notification interval');
  let stopped = false;
  let running = false;
  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      await notifications.enqueueDueReminders();
      await notifications.deliverDue();
      await notifications.pruneExpired();
    } catch {
      options.onError?.('NOTIFICATION_SCHEDULER_FAILED');
    } finally { running = false; }
  }
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
