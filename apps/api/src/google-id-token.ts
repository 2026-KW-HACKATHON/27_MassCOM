import { createPublicKey, createVerify, type JsonWebKey } from 'node:crypto';

const jwksUrl = 'https://www.googleapis.com/oauth2/v3/certs';
const acceptedIssuers = new Set(['accounts.google.com', 'https://accounts.google.com']);

export type GoogleIdTokenErrorCode =
  | 'ID_TOKEN_INVALID'
  | 'ID_TOKEN_EXPIRED'
  | 'ID_TOKEN_AUDIENCE_MISMATCH';

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
};

export type JwksFetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

type Options = {
  audiences: readonly string[];
  fetchJwks: JwksFetcher;
  now: () => Date;
  jwksMaxAgeMs: number;
  clockSkewMs: number;
};

type VerifierOptions = Pick<Options, 'audiences'> & Partial<Options>;

const defaultOptions = {
  fetchJwks: ((url) => fetch(url)) as JwksFetcher,
  now: () => new Date(),
  jwksMaxAgeMs: 10 * 60 * 1000,
  clockSkewMs: 60 * 1000,
};

export class GoogleIdTokenVerifier {
  private readonly options: Options;
  private keys = new Map<string, JsonWebKey>();
  private keysFetchedAt = 0;

  constructor(options: VerifierOptions) {
    this.options = { ...defaultOptions, ...options };
    if (this.options.audiences.length === 0) {
      throw new Error('at least one Google OAuth client id is required');
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
    if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
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

    return { subject, issuedAt, expiresAt };
  }

  // Google rotates signing keys, so an unknown key id earns exactly one refetch.
  private async publicKey(kid: string) {
    const stale = this.options.now().getTime() - this.keysFetchedAt >= this.options.jwksMaxAgeMs;
    if (stale) await this.refreshKeys();
    if (!this.keys.has(kid)) await this.refreshKeys();
    const jwk = this.keys.get(kid);
    if (!jwk) throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    try {
      return createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    }
  }

  private async refreshKeys(): Promise<void> {
    const response = await this.options.fetchJwks(jwksUrl);
    if (!response.ok) throw new GoogleIdTokenError('ID_TOKEN_INVALID');
    const body: unknown = await response.json();
    const keys = (body as { keys?: unknown }).keys;
    if (!Array.isArray(keys)) throw new GoogleIdTokenError('ID_TOKEN_INVALID');

    this.keys = new Map(
      keys
        .filter((key): key is JsonWebKey & { kid: string } => {
          const candidate = key as { kid?: unknown; kty?: unknown };
          return typeof candidate.kid === 'string' && candidate.kty === 'RSA';
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
