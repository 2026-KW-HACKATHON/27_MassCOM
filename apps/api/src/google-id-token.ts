import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';

const jwksUrl = 'https://www.googleapis.com/oauth2/v3/certs';
const acceptedIssuers = new Set(['accounts.google.com', 'https://accounts.google.com']);

export type GoogleIdTokenErrorCode =
  | 'ID_TOKEN_INVALID'
  | 'ID_TOKEN_EXPIRED'
  | 'ID_TOKEN_AUDIENCE_MISMATCH'
  | 'ID_TOKEN_KEY_SET_UNAVAILABLE';

// The rejected token is deliberately absent from the message: it is a bearer credential.
export class GoogleIdTokenError extends Error {
  constructor(readonly code: GoogleIdTokenErrorCode) {
    super(code);
    this.name = 'GoogleIdTokenError';
  }
}

export type GoogleIdTokenClaims = {
  subject: string;
  issuedAt: Date;
  expiresAt: Date;
  authTime?: Date;
};

export type JwksFetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

type Options = {
  audiences: readonly string[];
  fetchJwks: JwksFetcher;
  now: () => Date;
  jwksMaxAgeMs: number;
  jwksMaxStaleMs: number;
  unknownKeyRefreshIntervalMs: number;
  clockSkewMs: number;
};

type VerifierOptions = Pick<Options, 'audiences'> & Partial<Options>;

const defaultOptions = {
  fetchJwks: ((url) => fetch(url, { signal: AbortSignal.timeout(5_000) })) as JwksFetcher,
  now: () => new Date(),
  jwksMaxAgeMs: 10 * 60 * 1000,
  jwksMaxStaleMs: 24 * 60 * 60 * 1000,
  unknownKeyRefreshIntervalMs: 60 * 1000,
  clockSkewMs: 60 * 1000,
};

export class GoogleIdTokenVerifier {
  private readonly options: Options;
  private keys = new Map<string, JsonWebKey>();
  private lastRefreshAt = Number.NEGATIVE_INFINITY;
  private refreshing: Promise<void> | undefined;
  private keysFetchedAt = 0;

  constructor(options: VerifierOptions) {
    this.options = { ...defaultOptions, ...options };
    if (this.options.audiences.length === 0) {
      throw new Error('at least one Google OAuth client id is required');
    }
    if (
      !Number.isSafeInteger(this.options.jwksMaxStaleMs) ||
      this.options.jwksMaxStaleMs < this.options.jwksMaxAgeMs
    ) {
      throw new Error('jwksMaxStaleMs must be a safe integer at least as large as jwksMaxAgeMs');
    }
  }

  async verify(idToken: string): Promise<GoogleIdTokenClaims> {
    const segments = idToken.split('.');
    if (segments.length !== 3) throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    const [encodedHeader, encodedPayload, encodedSignature] = segments as [string, string, string];

    const header = decodeSegment(encodedHeader);
    if (header.alg !== 'RS256') throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    const kid = typeof header.kid === 'string' ? header.kid.trim() : '';
    if (!kid) throw new GoogleIdTokenError('ID_TOKEN_INVALID');

    const key = await this.publicKey(kid);
    const signed = createVerify('RSA-SHA256')
      .update(`${encodedHeader}.${encodedPayload}`)
      .verify(key, Buffer.from(encodedSignature, 'base64url'));
    if (!signed) throw new GoogleIdTokenError('ID_TOKEN_INVALID');

    return this.claims(decodeSegment(encodedPayload));
  }

  private claims(payload: Record<string, unknown>): GoogleIdTokenClaims {
    if (typeof payload.iss !== 'string' || !acceptedIssuers.has(payload.iss)) {
      throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    }
    if (typeof payload.aud !== 'string' || !this.options.audiences.includes(payload.aud)) {
      throw new GoogleIdTokenError('ID_TOKEN_AUDIENCE_MISMATCH');
    }
    if (
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number' ||
      !Number.isFinite(payload.exp) ||
      !Number.isFinite(payload.iat)
    ) {
      throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    }

    const now = this.options.now().getTime();
    const expiresAt = new Date(payload.exp * 1000);
    const issuedAt = new Date(payload.iat * 1000);
    if (expiresAt.getTime() <= now) throw new GoogleIdTokenError('ID_TOKEN_EXPIRED');
    if (issuedAt.getTime() > now + this.options.clockSkewMs) {
      throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    }

    const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    if (!subject) throw new GoogleIdTokenError('ID_TOKEN_INVALID');

    let authTime: Date | undefined;
    if (payload.auth_time !== undefined) {
      if (
        typeof payload.auth_time !== 'number' ||
        !Number.isFinite(payload.auth_time) ||
        payload.auth_time <= 0
      ) {
        throw new GoogleIdTokenError('ID_TOKEN_INVALID');
      }
      authTime = new Date(payload.auth_time * 1000);
      if (authTime.getTime() > now + this.options.clockSkewMs) {
        throw new GoogleIdTokenError('ID_TOKEN_INVALID');
      }
    }

    return { subject, issuedAt, expiresAt, ...(authTime ? { authTime } : {}) };
  }

  // Google rotates signing keys, so an unknown key id may earn a refetch. The token is still
  // unverified here and /auth/google needs no credential, so a caller sending random key ids must
  // not turn every request into an outbound fetch: unknown ids refetch at most once per interval.
  private async publicKey(kid: string) {
    // A refresh that fails keeps the last good key set: an outage at Google must not reject tokens
    // signed with keys we already hold, and the same interval bounds the retries.
    const now = this.options.now().getTime();
    const stale = now - this.keysFetchedAt >= this.options.jwksMaxAgeMs;
    let refreshFailed = false;
    if ((stale || !this.keys.has(kid)) && now - this.lastRefreshAt >= this.options.unknownKeyRefreshIntervalMs) {
      await this.refreshKeys().catch(() => {
        refreshFailed = true;
      });
    } else if (this.refreshing) {
      // Another verification is already fetching: wait for it rather than miss a key it brings.
      await this.refreshing.catch(() => {
        refreshFailed = true;
      });
    }
    const staleForMs = now - this.keysFetchedAt;
    if (
      (refreshFailed && this.keys.size === 0) ||
      (this.keys.has(kid) && staleForMs > this.options.jwksMaxStaleMs)
    ) {
      throw new GoogleIdTokenError('ID_TOKEN_KEY_SET_UNAVAILABLE');
    }
    const jwk = this.keys.get(kid);
    if (!jwk) throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    try {
      return createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    }
  }

  // Concurrent verifications share one outbound request.
  private refreshKeys(): Promise<void> {
    this.refreshing ??= this.fetchKeys().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async fetchKeys(): Promise<void> {
    this.lastRefreshAt = this.options.now().getTime();
    const response = await this.options.fetchJwks(jwksUrl);
    if (!response.ok) throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    const body: unknown = await response.json();
    const keys = (body as { keys?: unknown }).keys;
    if (!Array.isArray(keys)) throw new GoogleIdTokenError('ID_TOKEN_INVALID');

    this.keys = new Map(
      keys
        .filter((key): key is JsonWebKey & { kid: string } => {
          const candidate = key as { kid?: unknown; kty?: unknown; use?: unknown; alg?: unknown };
          return (
            typeof candidate.kid === 'string' &&
            candidate.kty === 'RSA' &&
            (candidate.use === undefined || candidate.use === 'sig') &&
            (candidate.alg === undefined || candidate.alg === 'RS256')
          );
        })
        .map((key) => [key.kid, key]),
    );
    this.keysFetchedAt = this.options.now().getTime();
  }
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new GoogleIdTokenError('ID_TOKEN_INVALID');
  }
}
