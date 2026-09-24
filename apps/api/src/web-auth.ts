import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Pool } from 'pg';

import type { PostgresWebSessionStore } from './postgres/web-session.js';

type Options = {
  clientId: string;
  webCredential: string;
  redirectUri: string;
  exchangeCode?: (code: string, verifier: string) => Promise<string>;
  verifyIdToken: (token: string) => Promise<{ subject: string; nonce?: string }>;
};

export function resolveWebAuthConfig(env: NodeJS.ProcessEnv): Pick<Options, 'clientId' | 'webCredential' | 'redirectUri'> | undefined {
  const clientId = env.GOOGLE_WEB_CLIENT_ID?.trim();
  const webCredential = env.GOOGLE_WEB_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_WEB_REDIRECT_URI?.trim();
  if (!clientId && !webCredential && !redirectUri) return undefined;
  if (!clientId || !webCredential || redirectUri !== 'https://masscom.kr/api/web/auth/callback' ||
    !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('WEB_AUTH_CONFIGURATION_INVALID');
  }
  return { clientId, webCredential, redirectUri };
}

export class WebAuthError extends Error {
  constructor(readonly code: 'WEB_AUTH_STATE_INVALID' | 'WEB_AUTH_NONCE_INVALID' |
    'WEB_AUTH_ACCOUNT_NOT_FOUND' | 'WEB_AUTH_CODE_INVALID' | 'WEB_AUTH_UPSTREAM_UNAVAILABLE') {
    super(code);
    this.name = 'WebAuthError';
  }
}

export type WebAuthHandler = Pick<WebAuthService, 'start' | 'complete' | 'resolveSession' | 'logout'>;

const stateTtlMs = 5 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const digest = (value: string) => createHash('sha256').update(value).digest();
const randomToken = () => randomBytes(32).toString('base64url');

export async function exchangeGoogleCode(input: {
  clientId: string; webCredential: string; redirectUri: string; code: string; verifier: string;
}, fetcher: (url: string, options: RequestInit) => Promise<Response> = fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: input.clientId,
        client_secret: input.webCredential,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: input.verifier,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new WebAuthError('WEB_AUTH_UPSTREAM_UNAVAILABLE');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new WebAuthError('WEB_AUTH_UPSTREAM_UNAVAILABLE');
  }
  if (!body || typeof body !== 'object') throw new WebAuthError('WEB_AUTH_UPSTREAM_UNAVAILABLE');
  if (!response.ok) {
    if (response.status === 400 && (body as { error?: unknown }).error === 'invalid_grant') {
      throw new WebAuthError('WEB_AUTH_CODE_INVALID');
    }
    throw new WebAuthError('WEB_AUTH_UPSTREAM_UNAVAILABLE');
  }
  const idToken = (body as { id_token?: unknown }).id_token;
  if (typeof idToken !== 'string' || !idToken) throw new WebAuthError('WEB_AUTH_UPSTREAM_UNAVAILABLE');
  return idToken;
}

export class WebAuthService {
  constructor(
    private readonly pool: Pool,
    private readonly sessions: PostgresWebSessionStore,
    private readonly options: Options,
  ) {
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(options.clientId) ||
      !options.webCredential ||
      options.redirectUri !== 'https://masscom.kr/api/web/auth/callback') {
      throw new Error('WEB_AUTH_CONFIGURATION_INVALID');
    }
  }

  async start(): Promise<{ location: string; state: string }> {
    await this.pool.query(
      `WITH stale AS (
         SELECT state_hash FROM web_oauth_states
         WHERE expires_at <= $1 ORDER BY expires_at LIMIT 100
       )
       DELETE FROM web_oauth_states AS states USING stale
       WHERE states.state_hash = stale.state_hash`,
      [new Date()],
    );
    const state = randomToken();
    const verifier = randomToken();
    const nonce = randomToken();
    const expiresAt = new Date(Date.now() + stateTtlMs);
    await this.pool.query(
      `INSERT INTO web_oauth_states(state_hash, code_verifier, nonce, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [digest(state), verifier, nonce, expiresAt],
    );
    const location = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    location.searchParams.set('client_id', this.options.clientId);
    location.searchParams.set('redirect_uri', this.options.redirectUri);
    location.searchParams.set('response_type', 'code');
    location.searchParams.set('scope', 'openid');
    location.searchParams.set('state', state);
    location.searchParams.set('nonce', nonce);
    location.searchParams.set('code_challenge', digest(verifier).toString('base64url'));
    location.searchParams.set('code_challenge_method', 'S256');
    return { location: location.toString(), state };
  }

  async complete(code: string, state: string, cookieState: string): Promise<{ token: string }> {
    if (!code || !tokenPattern.test(state) || !tokenPattern.test(cookieState) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(cookieState))) {
      throw new WebAuthError('WEB_AUTH_STATE_INVALID');
    }
    const consumed = await this.pool.query<{ code_verifier: string; nonce: string }>(
      `DELETE FROM web_oauth_states
       WHERE state_hash = $1 AND expires_at > $2
       RETURNING code_verifier, nonce`,
      [digest(state), new Date()],
    );
    const pending = consumed.rows[0];
    if (!pending) throw new WebAuthError('WEB_AUTH_STATE_INVALID');
    const idToken = await (this.options.exchangeCode ?? this.exchangeGoogleCode.bind(this))(
      code, pending.code_verifier,
    );
    const claims = await this.options.verifyIdToken(idToken);
    if (claims.nonce !== pending.nonce) throw new WebAuthError('WEB_AUTH_NONCE_INVALID');
    const account = await this.pool.query<{ account_id: string }>(
      `SELECT account_id FROM auth_identities WHERE provider = 'google' AND subject = $1`,
      [claims.subject],
    );
    const accountId = account.rows[0]?.account_id;
    if (!accountId) throw new WebAuthError('WEB_AUTH_ACCOUNT_NOT_FOUND');
    const session = await this.sessions.create(accountId);
    return { token: session.token };
  }

  async resolveSession(token: string): Promise<string> {
    return this.sessions.resolve(token);
  }

  async logout(token: string): Promise<void> {
    await this.sessions.revoke(token);
  }

  private async exchangeGoogleCode(code: string, verifier: string): Promise<string> {
    return exchangeGoogleCode({
      clientId: this.options.clientId,
      webCredential: this.options.webCredential,
      redirectUri: this.options.redirectUri,
      code,
      verifier,
    });
  }
}
