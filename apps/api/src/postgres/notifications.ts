import { createHash, createSign, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  NotificationError, validateNotification,
  type NotificationInput, type NotificationItem, type NotificationPreferences, type NotificationService,
} from '../notifications.js';
import type { PostgresAccountLifecycle } from './account-lifecycle.js';

type ItemRow = { id: string; category: NotificationItem['category']; title: string; body: string; target_path: string; created_at: Date; read_at: Date | null };
type PreferenceRow = { push_enabled: boolean; reward_available: boolean; coupon_expiring: boolean; campaign_expiring: boolean };
type DeliveryRow = { id: string; token: string; notification_id: string; device_id: string; title: string; body: string; target_path: string; category: string };
type FcmConfig = { projectId: string; clientEmail: string; signingPem: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultPreferences: NotificationPreferences = { pushEnabled: false, rewardAvailable: true, couponExpiring: true, campaignExpiring: true };
const preferenceColumns = { pushEnabled: 'push_enabled', rewardAvailable: 'reward_available', couponExpiring: 'coupon_expiring', campaignExpiring: 'campaign_expiring' } as const;
const categoryColumns = { REWARD_AVAILABLE: 'reward_available', COUPON_EXPIRING: 'coupon_expiring', CAMPAIGN_EXPIRING: 'campaign_expiring' } as const;

// Recheck the live source at inbox read, lease acquisition and immediately before send.
// A null source preserves generic internal notices; scheduler reminders always bind one.
function eligibleSource(alias: string, time: string): string {
  return `(${alias}.source_kind IS NULL
    OR (${alias}.source_kind='REWARD_AVAILABLE' AND EXISTS (SELECT 1 FROM reward_entitlements source
      WHERE source.id::text=${alias}.source_id AND source.customer_account_id=${alias}.account_id
        AND source.status='GRANTED' AND source.claim_expires_at>${time}))
    OR (${alias}.source_kind='COUPON_EXPIRING' AND EXISTS (SELECT 1 FROM badge_coupons source
      WHERE source.id::text=${alias}.source_id AND source.customer_account_id=${alias}.account_id
        AND source.status='ISSUED' AND source.expires_at=${alias}.source_expires_at AND source.expires_at>${time}))
    OR (${alias}.source_kind='CAMPAIGN_EXPIRING' AND EXISTS (SELECT 1 FROM campaigns source
      JOIN merchant_members owner ON owner.merchant_id=source.merchant_id
      WHERE source.id=${alias}.source_id AND source.status='ACTIVE'
        AND source.ends_at=${alias}.source_expires_at AND source.ends_at>${time}
        AND owner.account_id=${alias}.account_id AND owner.status='ACTIVE' AND owner.role='OWNER'))) `;
}

function mappedPreferences(row?: PreferenceRow): NotificationPreferences {
  return row ? { pushEnabled: row.push_enabled, rewardAvailable: row.reward_available, couponExpiring: row.coupon_expiring, campaignExpiring: row.campaign_expiring } : defaultPreferences;
}
function base64url(input: string | Buffer): string { return Buffer.from(input).toString('base64url'); }
export function fcmRetryAfter(value: string | null, now: Date): Date | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : undefined;
  const timestamp = seconds === undefined ? Date.parse(value) : now.getTime() + seconds * 1000;
  return Number.isFinite(timestamp) && timestamp > now.getTime() && timestamp <= now.getTime() + 86_400_000
    ? new Date(timestamp) : undefined;
}

export function fcmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FcmConfig | undefined {
  const projectId = env.FCM_PROJECT_ID?.trim();
  const clientEmail = env.FCM_CLIENT_EMAIL?.trim();
  const signingPem = env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (!projectId || !clientEmail || !signingPem) return undefined;
  if (!/^[a-z0-9-]+$/.test(projectId) || !/^[^\s@]+@[^\s@]+$/.test(clientEmail)) throw new Error('invalid FCM configuration');
  return { projectId, clientEmail, signingPem };
}

async function fcmAccessToken(config: FcmConfig, fetcher: typeof fetch, now: Date): Promise<string> {
  const seconds = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: config.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: seconds, exp: seconds + 3600 }));
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${sign.sign(config.signingPem).toString('base64url')}`;
  const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`FCM_AUTH_${response.status}`);
  const json = await response.json() as { access_token?: string };
  if (!json.access_token) throw new Error('FCM_AUTH_INVALID');
  return json.access_token;
}

export class PostgresNotificationService implements NotificationService {
  constructor(private readonly pool: Pool, private readonly options: { accountLifecycle: PostgresAccountLifecycle; now?: () => Date; fetcher?: typeof fetch; fcm?: FcmConfig }) {}
  private now(): Date { return this.options.now?.() ?? new Date(); }
  private async withActiveAccount<T>(accountId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.options.accountLifecycle.assertActive(client, accountId);
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async list(accountId: string): Promise<NotificationItem[]> {
    const result = await this.pool.query<ItemRow>(`SELECT id, category, title, body, target_path, created_at, read_at FROM notification_items item WHERE account_id=$1 AND ${eligibleSource('item', '$2')} ORDER BY created_at DESC, id DESC LIMIT 100`, [accountId, this.now()]);
    return result.rows.map(row => ({ id: row.id, category: row.category, title: row.title, body: row.body, targetPath: row.target_path, createdAt: row.created_at.toISOString(), readAt: row.read_at?.toISOString() ?? null }));
  }
  async preferences(accountId: string): Promise<NotificationPreferences> {
    const result = await this.pool.query<PreferenceRow>('SELECT push_enabled, reward_available, coupon_expiring, campaign_expiring FROM notification_preferences WHERE account_id=$1', [accountId]);
    return mappedPreferences(result.rows[0]);
  }
  async updatePreferences(accountId: string, patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const keys = Object.keys(patch) as (keyof NotificationPreferences)[];
    if (!keys.length || keys.some(key => !(key in preferenceColumns) || typeof patch[key] !== 'boolean')) throw new NotificationError('INVALID_NOTIFICATION');
    const assignments = keys.map((key, index) => `${preferenceColumns[key]}=$${index + 2}`).join(', ');
    return this.withActiveAccount(accountId, async client => {
      await client.query('INSERT INTO notification_preferences(account_id) VALUES($1) ON CONFLICT(account_id) DO NOTHING', [accountId]);
      const updated = await client.query<PreferenceRow>(`UPDATE notification_preferences SET ${assignments}, updated_at=now() WHERE account_id=$1 RETURNING push_enabled, reward_available, coupon_expiring, campaign_expiring`, [accountId, ...keys.map(key => patch[key])]);
      return mappedPreferences(updated.rows[0]);
    });
  }
  async registerDevice(accountId: string, deviceId: string, token: string, platform: 'android', sessionToken: string): Promise<void> {
    if (!uuid.test(deviceId) || !token.trim() || token.length > 4096 || platform !== 'android' || !sessionToken) throw new NotificationError('INVALID_NOTIFICATION');
    await this.withActiveAccount(accountId, async client => {
      const session = await client.query<{ id: string; created_at: Date }>(`SELECT id, created_at FROM auth_sessions WHERE account_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>$3`, [accountId, createHash('sha256').update(sessionToken).digest(), this.now()]);
      if (!session.rows[0]) throw new NotificationError('INVALID_NOTIFICATION');
      // Tokens rotate; a token may also be reissued after reinstall. A fresh authenticated registration owns it.
      await client.query('DELETE FROM notification_devices WHERE token=$1 AND device_id<>$2', [token, deviceId]);
      await client.query(`INSERT INTO notification_devices(device_id,account_id,session_id,token,platform) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(device_id) DO UPDATE SET account_id=excluded.account_id, session_id=excluded.session_id, token=excluded.token, platform=excluded.platform, updated_at=now()
        WHERE (SELECT created_at FROM auth_sessions WHERE id=notification_devices.session_id) <= $6`, [deviceId, accountId, session.rows[0].id, token, platform, session.rows[0].created_at]);
    });
  }
  async unregisterDevice(accountId: string, deviceId: string): Promise<void> {
    if (!uuid.test(deviceId)) throw new NotificationError('INVALID_NOTIFICATION');
    await this.pool.query('DELETE FROM notification_devices WHERE account_id=$1 AND device_id=$2', [accountId, deviceId]);
  }
  async markRead(accountId: string, id: string): Promise<void> {
    if (!uuid.test(id)) throw new NotificationError('INVALID_NOTIFICATION');
    const result = await this.pool.query('UPDATE notification_items SET read_at=coalesce(read_at,$3) WHERE account_id=$1 AND id=$2', [accountId, id, this.now()]);
    if (!result.rowCount) throw new NotificationError('NOT_FOUND');
  }
  async enqueue(input: NotificationInput): Promise<boolean> {
    validateNotification(input);
    return this.withActiveAccount(input.accountId, async client => {
      const inserted = await client.query<{ id: string }>(`INSERT INTO notification_items(id,account_id,category,dedupe_key,title,body,target_path,created_at,source_kind,source_id,source_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(account_id,dedupe_key) DO NOTHING RETURNING id`,
      [randomUUID(), input.accountId, input.category, input.dedupeKey, input.title, input.body, input.targetPath, this.now(), input.source?.kind ?? null, input.source?.id ?? null, input.source?.expiresAt ?? null]);
      const id = inserted.rows[0]?.id;
      if (id) await client.query(`INSERT INTO notification_deliveries(id,notification_id,device_id,due_at)
        SELECT gen_random_uuid(),$1,device.device_id,$3 FROM notification_devices device
        JOIN auth_sessions session ON session.id=device.session_id
        LEFT JOIN notification_preferences pref ON pref.account_id=device.account_id
        WHERE device.account_id=$2 AND session.revoked_at IS NULL AND session.expires_at>$3
          AND coalesce(pref.push_enabled,false) AND coalesce(pref.${categoryColumns[input.category]},true)`, [id, input.accountId, this.now()]);
      return Boolean(id);
    });
  }
  async enqueueDueReminders(): Promise<number> {
    const now = this.now();
    let count = 0;
    const rewards = await this.pool.query<{ id: string; customer_account_id: string; merchant_name: string }>(`SELECT reward.id, reward.customer_account_id, merchant.name AS merchant_name
      FROM reward_entitlements reward JOIN campaigns campaign ON campaign.id=reward.campaign_id
      JOIN merchants merchant ON merchant.id=campaign.merchant_id
      WHERE reward.status='GRANTED' AND reward.claim_expires_at>$1
        AND reward.earned_at >= $1::timestamptz-interval '90 days'
        AND NOT EXISTS (SELECT 1 FROM account_deletion_requests deleted WHERE deleted.deleted_account_alias=reward.customer_account_id)`, [now]);
    for (const reward of rewards.rows) {
      if (await this.enqueue({ accountId: reward.customer_account_id, category: 'REWARD_AVAILABLE', dedupeKey: `reward:${reward.id}`, source: { kind: 'REWARD_AVAILABLE', id: reward.id }, title: '받을 수 있는 보상이 있어요', body: `${reward.merchant_name} 방문 보상을 확인해 주세요.`, targetPath: `/collection?focus=collectible&entitlement=${reward.id}` })) count++;
    }
    // Within 24h and still usable. Dedupe keys include the current expiry so extensions can produce a fresh reminder.
    const coupons = await this.pool.query<{ id: string; customer_account_id: string; title: string; merchant_id: string; expires_at: Date }>(`SELECT id, customer_account_id, title, merchant_id, expires_at FROM badge_coupons
      WHERE status='ISSUED' AND expires_at>$1 AND expires_at<=$1::timestamptz+interval '24 hours'
        AND NOT EXISTS (SELECT 1 FROM account_deletion_requests deleted WHERE deleted.deleted_account_alias=badge_coupons.customer_account_id)`, [now]);
    for (const coupon of coupons.rows) {
      if (await this.enqueue({ accountId: coupon.customer_account_id, category: 'COUPON_EXPIRING', dedupeKey: `coupon:${coupon.id}:${coupon.expires_at.toISOString()}`, source: { kind: 'COUPON_EXPIRING', id: coupon.id, expiresAt: coupon.expires_at.toISOString() }, title: '쿠폰이 곧 만료돼요', body: `${coupon.title} 쿠폰을 만료 전에 확인해 주세요.`, targetPath: `/collection?focus=rewards&coupon=${coupon.id}` })) count++;
    }
    const campaigns = await this.pool.query<{ id: string; title: string; merchant_id: string; ends_at: Date; account_id: string }>(`SELECT campaign.id, campaign.title, campaign.merchant_id, campaign.ends_at, member.account_id
      FROM campaigns campaign JOIN merchant_members member ON member.merchant_id=campaign.merchant_id
      WHERE campaign.status='ACTIVE' AND member.status='ACTIVE' AND member.role='OWNER'
        AND campaign.ends_at>$1 AND campaign.ends_at<=$1::timestamptz+interval '72 hours'`, [now]);
    for (const campaign of campaigns.rows) {
      if (await this.enqueue({ accountId: campaign.account_id, category: 'CAMPAIGN_EXPIRING', dedupeKey: `campaign:${campaign.id}:${campaign.ends_at.toISOString()}`, source: { kind: 'CAMPAIGN_EXPIRING', id: campaign.id, expiresAt: campaign.ends_at.toISOString() }, title: '캠페인 종료가 가까워요', body: `${campaign.title} 캠페인 일정을 확인해 주세요.`, targetPath: '/merchant' })) count++;
    }
    return count;
  }
  async pruneExpired(): Promise<void> {
    const now = this.now();
    // Removing an item cascades to delivery rows, including provider references.
    await this.pool.query(`DELETE FROM notification_items WHERE id IN (
      SELECT id FROM notification_items WHERE created_at<$1::timestamptz-interval '90 days'
      ORDER BY created_at,id LIMIT 1000)`, [now]);
    await this.pool.query(`DELETE FROM notification_devices WHERE device_id IN (
      SELECT device.device_id FROM notification_devices device JOIN auth_sessions session ON session.id=device.session_id
      WHERE session.revoked_at IS NOT NULL OR session.expires_at<=$1 ORDER BY device.updated_at,device.device_id LIMIT 1000)`, [now]);
    await this.pool.query(`UPDATE notification_deliveries delivery SET status='FAILED', last_error='NOT_ELIGIBLE', lease_owner=NULL, lease_expires_at=NULL
      WHERE delivery.id IN (SELECT pending.id FROM notification_deliveries pending
        LEFT JOIN notification_items item ON item.id=pending.notification_id
        LEFT JOIN notification_devices device ON device.device_id=pending.device_id
        LEFT JOIN auth_sessions session ON session.id=device.session_id
        LEFT JOIN notification_preferences pref ON pref.account_id=item.account_id
        WHERE (pending.status='PENDING' OR (pending.status='LEASED' AND pending.lease_expires_at<$1))
          AND (pending.attempts>=5 OR item.id IS NULL OR device.account_id IS DISTINCT FROM item.account_id
            OR session.revoked_at IS NOT NULL OR session.expires_at<=$1 OR NOT coalesce(pref.push_enabled,false)
            OR NOT ${eligibleSource('item', '$1')} OR NOT CASE item.category WHEN 'REWARD_AVAILABLE' THEN coalesce(pref.reward_available,true)
              WHEN 'COUPON_EXPIRING' THEN coalesce(pref.coupon_expiring,true)
              WHEN 'CAMPAIGN_EXPIRING' THEN coalesce(pref.campaign_expiring,true) ELSE false END)
        ORDER BY pending.due_at,pending.id LIMIT 1000)`, [now]);
  }
  async deliverDue(limit = 5): Promise<{ sent: number; failed: number; skipped: number }> {
    // A send has a 10s timeout. A five-job batch fits comfortably inside its two-minute lease.
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5) throw new RangeError('invalid delivery limit');
    const config = this.options.fcm ?? fcmConfigFromEnv();
    if (!config) return { sent: 0, failed: 0, skipped: 0 };
    const leaseOwner = randomUUID();
    const claimed = await this.pool.query<DeliveryRow>(`UPDATE notification_deliveries delivery SET status='LEASED', attempts=attempts+1,
        lease_owner=$2, lease_expires_at=$3::timestamptz+interval '2 minutes'
      FROM (SELECT pending.id FROM notification_deliveries pending
        JOIN notification_items notice ON notice.id=pending.notification_id
        JOIN notification_devices endpoint ON endpoint.device_id=pending.device_id
        JOIN auth_sessions active_session ON active_session.id=endpoint.session_id
        JOIN notification_preferences enabled ON enabled.account_id=notice.account_id
        WHERE (pending.status='PENDING' OR (pending.status='LEASED' AND pending.lease_expires_at<$3))
          AND ${eligibleSource('notice', '$3')} AND pending.due_at<=$3 AND pending.attempts<5 AND endpoint.account_id=notice.account_id
          AND active_session.revoked_at IS NULL AND active_session.expires_at>$3 AND enabled.push_enabled
          AND ((notice.category='REWARD_AVAILABLE' AND enabled.reward_available)
            OR (notice.category='COUPON_EXPIRING' AND enabled.coupon_expiring)
            OR (notice.category='CAMPAIGN_EXPIRING' AND enabled.campaign_expiring))
        ORDER BY pending.due_at,pending.id LIMIT $1 FOR UPDATE OF pending SKIP LOCKED) job,
        notification_items item, notification_devices device, notification_preferences pref, auth_sessions session
      WHERE delivery.id=job.id AND item.id=delivery.notification_id AND device.device_id=delivery.device_id
        AND session.id=device.session_id AND session.revoked_at IS NULL AND session.expires_at>$3
        AND ${eligibleSource('item', '$3')} AND pref.account_id=item.account_id AND pref.push_enabled AND device.account_id=item.account_id
        AND ((item.category='REWARD_AVAILABLE' AND pref.reward_available)
          OR (item.category='COUPON_EXPIRING' AND pref.coupon_expiring)
          OR (item.category='CAMPAIGN_EXPIRING' AND pref.campaign_expiring))
      RETURNING delivery.id, delivery.notification_id, delivery.device_id, device.token, item.title, item.body, item.target_path, item.category`, [limit, leaseOwner, this.now()]);
    let sent = 0; let failed = 0; let skipped = 0;
    if (!claimed.rows.length) return { sent, failed, skipped };
    let bearer: string;
    try { bearer = await fcmAccessToken(config, this.options.fetcher ?? fetch, this.now()); }
    catch { await this.releaseLease(leaseOwner); return { sent, failed: claimed.rowCount ?? 0, skipped }; }
    for (const row of claimed.rows) {
      // Account switch, logout and changed preferences revoke pending delivery even if it was leased.
      const allowed = await this.pool.query(`UPDATE notification_deliveries d SET lease_expires_at=$4::timestamptz+interval '2 minutes'
        FROM notification_devices device, auth_sessions session, notification_items item, notification_preferences pref
        WHERE d.id=$1 AND d.lease_owner=$2 AND d.lease_expires_at>$4 AND d.status='LEASED'
          AND device.device_id=d.device_id AND item.id=d.notification_id AND session.id=device.session_id
          AND pref.account_id=item.account_id AND device.account_id=item.account_id AND device.token=$3 AND pref.push_enabled
          AND ${eligibleSource('item', '$4')} AND session.revoked_at IS NULL AND session.expires_at>$4
        AND ((item.category='REWARD_AVAILABLE' AND pref.reward_available) OR (item.category='COUPON_EXPIRING' AND pref.coupon_expiring) OR (item.category='CAMPAIGN_EXPIRING' AND pref.campaign_expiring))`, [row.id, leaseOwner, row.token, this.now()]);
      if (!allowed.rowCount) { skipped++; await this.pool.query(`UPDATE notification_deliveries SET status='FAILED', lease_owner=NULL, lease_expires_at=NULL, last_error='PREFERENCE_DEVICE_OR_SOURCE_CHANGED' WHERE id=$1 AND lease_owner=$2`, [row.id, leaseOwner]); continue; }
      try {
        const response = await (this.options.fetcher ?? fetch)(`https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`, {
          method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ message: { token: row.token, notification: { title: row.title, body: row.body }, data: { notificationId: row.notification_id, targetPath: row.target_path }, android: { priority: 'normal', notification: { channel_id: 'masscom-updates', tag: row.notification_id } } } }),
        });
        if (response.ok) {
          const result = await response.json() as { name?: string };
          await this.pool.query(`UPDATE notification_deliveries SET status='SENT', lease_owner=NULL, lease_expires_at=NULL, sent_at=$3, provider_message_id=$4 WHERE id=$1 AND lease_owner=$2`, [row.id, leaseOwner, this.now(), result.name ?? null]); sent++;
        } else {
          const error = await response.json().catch(() => ({})) as { error?: { status?: string; details?: { '@type'?: string; errorCode?: string }[] } };
          const fcmCode = error.error?.details?.find(detail => detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode;
          const staleToken = fcmCode === 'UNREGISTERED' || error.error?.status === 'UNREGISTERED';
          if (staleToken) await this.pool.query('DELETE FROM notification_devices WHERE device_id=$1 AND token=$2', [row.device_id, row.token]);
          await this.retry(row.id, leaseOwner, `FCM_${response.status}`, staleToken || fcmCode === 'INVALID_ARGUMENT', fcmRetryAfter(response.headers.get('retry-after'), this.now())); failed++;
        }
      } catch { await this.retry(row.id, leaseOwner, 'FCM_NETWORK', false); failed++; }
    }
    return { sent, failed, skipped };
  }
  private async releaseLease(owner: string): Promise<void> {
    await this.pool.query(`UPDATE notification_deliveries SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,
      lease_owner=NULL, lease_expires_at=NULL, last_error='FCM_AUTH',
      due_at=$2::timestamptz+interval '5 minutes' WHERE lease_owner=$1`, [owner, this.now()]);
  }
  private async retry(id: string, owner: string, error: string, permanent: boolean, retryAfter?: Date): Promise<void> {
    await this.pool.query(`UPDATE notification_deliveries SET status=CASE WHEN $4 OR attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,
      lease_owner=NULL, lease_expires_at=NULL, last_error=$3,
      due_at=greatest($5::timestamptz+make_interval(secs=>least(3600,30*power(2,attempts)::int)),coalesce($6::timestamptz,$5::timestamptz))
      WHERE id=$1 AND lease_owner=$2`, [id, owner, error, permanent, this.now(), retryAfter ?? null]);
  }
}
