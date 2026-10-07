import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';

export type NotificationCategory = 'REWARD_AVAILABLE' | 'COUPON_EXPIRING' | 'CAMPAIGN_EXPIRING';
export type NotificationItem = {
  id: string; category: NotificationCategory; title: string; body: string;
  targetPath: string; createdAt: string; readAt: string | null;
};
export type NotificationPreferences = {
  pushEnabled: boolean; rewardAvailable: boolean; couponExpiring: boolean; campaignExpiring: boolean;
};

export class NotificationApiClient {
  constructor(private readonly apiUrl: string, private readonly credential: AccountCredential, private readonly onSessionInvalid?: () => void | Promise<void>) {}
  private async request(path: string, method = 'GET', body?: unknown): Promise<any> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method, headers: { ...headersForCredential(this.credential), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined);
      const code = payload && typeof payload.code === 'string' ? payload.code : '';
      if (shouldInvalidateSession(this.credential, response.status, code)) await this.onSessionInvalid?.();
      throw new Error(`NOTIFICATION_API_${response.status}`);
    }
    return response.status === 204 ? undefined : response.json();
  }
  async list(): Promise<NotificationItem[]> { const result = await this.request('/api/notifications'); return result.items; }
  async preferences(): Promise<NotificationPreferences> { const result = await this.request('/api/notifications/preferences'); return result.preferences; }
  async updatePreferences(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const result = await this.request('/api/notifications/preferences', 'PATCH', patch); return result.preferences;
  }
  async registerDevice(deviceId: string, token: string): Promise<void> {
    await this.request('/api/notifications/devices', 'POST', { deviceId, token, platform: 'android' });
  }
  async unregisterDevice(deviceId: string): Promise<void> {
    await this.request('/api/notifications/devices', 'DELETE', { deviceId });
  }
  async markRead(id: string): Promise<void> { await this.request(`/api/notifications/${encodeURIComponent(id)}/read`, 'POST'); }
}
